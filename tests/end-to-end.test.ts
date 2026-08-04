import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { createReplyToMessage } from '../src/application/reply-to-message.ts'
import type { AiProvider } from '../src/domain/ports.ts'
import { createWhatsAppChannel } from '../src/infrastructure/channels/whatsapp.ts'
import { createApp } from '../src/infrastructure/http/server.ts'
import { createInMemoryProcessedMessages } from '../src/infrastructure/processed-messages.ts'
import { hmacSha256Hex } from '../src/infrastructure/signature.ts'
import { createWorkQueue } from '../src/infrastructure/work-queue.ts'
import { collectingLogger } from './support/doubles.ts'

/**
 * The whole stack, wired the way `main.ts` wires it: real HTTP, real queue,
 * real use case, real adapters. Only the network is doubled.
 *
 * The narrower suites double the queue, which makes handing work off look
 * instant and would let the acknowledge-before-working property pass even if
 * it had been broken. Here the model is genuinely slow, so the ordering is
 * observable.
 */

const APP_SECRET = 'app-secret'
const MODEL_DELAY_MS = 300

type Harness = {
  readonly url: string
  readonly sends: string[]
  readonly drain: () => Promise<boolean>
  readonly close: () => Promise<void>
}

async function stack(options?: { readonly aiFails?: boolean }): Promise<Harness> {
  const sends: string[] = []

  // The only double: the socket. Everything above it is production code.
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sends.push(String(init?.body))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const ai: AiProvider = {
    name: 'slow-model',
    async reply(prompt) {
      await new Promise((resolve) => setTimeout(resolve, MODEL_DELAY_MS))
      if (options?.aiFails === true) throw new Error('model unavailable')
      return `echo: ${prompt}`
    },
  }

  const channel = createWhatsAppChannel({
    appSecret: APP_SECRET,
    verifyToken: 'verify',
    accessToken: 'token',
    phoneNumberId: '1',
    graphVersion: 'v26.0',
    timeoutMs: 2000,
    retries: 0,
    fetchImpl,
  })

  const replyToMessage = createReplyToMessage({
    ai,
    processed: createInMemoryProcessedMessages({ ttlMs: 60_000, maxEntries: 100 }),
    fallbackText: 'FALLBACK',
    unsupportedText: 'TEXT ONLY',
  })

  const queue = createWorkQueue({ concurrency: 4, maxPending: 100, onError: () => {} })
  const { logger } = collectingLogger()

  const app = createApp({
    channels: [channel],
    logger,
    maxBodyBytes: 64 * 1024,
    isReady: () => true,
    enqueue: (target, message) => queue.enqueue(() => replyToMessage(target, message).then(() => undefined)),
  })

  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    sends,
    drain: () => queue.drain(5000),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function delivery(id: string, text: string, type = 'text'): string {
  const message =
    type === 'text'
      ? { id, from: '34600111222', type, text: { body: text } }
      : { id, from: '34600111222', type }

  return JSON.stringify({ entry: [{ changes: [{ value: { messages: [message] } }] }] })
}

async function post(harness: Harness, body: string): Promise<Response> {
  return fetch(`${harness.url}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${hmacSha256Hex(APP_SECRET, Buffer.from(body, 'utf8'))}`,
    },
    body,
  })
}

describe('end to end', () => {
  it('acknowledges long before the slow model has answered', async (t) => {
    const harness = await stack()
    t.after(() => harness.close())

    const startedAt = performance.now()
    const response = await post(harness, delivery('wamid.1', 'hello'))
    const acknowledgedIn = performance.now() - startedAt

    assert.equal(response.status, 200)
    assert.ok(
      acknowledgedIn < MODEL_DELAY_MS / 2,
      `acknowledged in ${Math.round(acknowledgedIn)}ms, model takes ${MODEL_DELAY_MS}ms`,
    )
    assert.deepEqual(harness.sends, [], 'nothing has been sent yet, the work is still queued')

    await harness.drain()

    assert.equal(harness.sends.length, 1, 'and it completes after the acknowledgement')
    assert.ok(String(harness.sends[0]).includes('echo: hello'))
  })

  it('answers a retried delivery once, not twice', async (t) => {
    const harness = await stack()
    t.after(() => harness.close())

    // What Meta does when it does not see a 200 quickly enough.
    const body = delivery('wamid.2', 'hello')
    await Promise.all([post(harness, body), post(harness, body), post(harness, body)])
    await harness.drain()

    assert.equal(harness.sends.length, 1, 'three deliveries, one reply')
  })

  it('sends the fallback when the model fails, and still only once', async (t) => {
    const harness = await stack({ aiFails: true })
    t.after(() => harness.close())

    await post(harness, delivery('wamid.3', 'hello'))
    await harness.drain()

    assert.equal(harness.sends.length, 1)
    assert.ok(String(harness.sends[0]).includes('FALLBACK'))
  })

  it('answers a sticker without waiting for the model at all', async (t) => {
    const harness = await stack()
    t.after(() => harness.close())

    const startedAt = performance.now()
    await post(harness, delivery('wamid.4', '', 'sticker'))
    await harness.drain()
    const elapsed = performance.now() - startedAt

    assert.ok(String(harness.sends[0]).includes('TEXT ONLY'))
    assert.ok(elapsed < MODEL_DELAY_MS, `finished in ${Math.round(elapsed)}ms, the model was never called`)
  })

  it('handles a burst concurrently rather than one at a time', async (t) => {
    const harness = await stack()
    t.after(() => harness.close())

    const startedAt = performance.now()
    await Promise.all(
      Array.from({ length: 4 }, (_unused, index) => post(harness, delivery(`wamid.b${index}`, `msg ${index}`))),
    )
    await harness.drain()
    const elapsed = performance.now() - startedAt

    assert.equal(harness.sends.length, 4)
    assert.ok(
      elapsed < MODEL_DELAY_MS * 2,
      `four ${MODEL_DELAY_MS}ms calls finished in ${Math.round(elapsed)}ms, so they overlapped`,
    )
  })

  it('rejects an unsigned delivery before any of this happens', async (t) => {
    const harness = await stack()
    t.after(() => harness.close())

    const response = await fetch(`${harness.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: delivery('wamid.5', 'hello'),
    })
    await harness.drain()

    assert.equal(response.status, 403)
    assert.deepEqual(harness.sends, [])
  })
})
