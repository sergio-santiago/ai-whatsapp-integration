import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import type { Channel } from '../src/domain/ports.ts'
import type { IncomingMessage } from '../src/domain/types.ts'
import { createWhatsAppChannel } from '../src/infrastructure/channels/whatsapp.ts'
import { createApp } from '../src/infrastructure/http/server.ts'
import { hmacSha256Hex } from '../src/infrastructure/signature.ts'
import { collectingLogger, fakeChannel } from './support/doubles.ts'

/**
 * The HTTP edge, exercised over a real socket.
 *
 * No test client dependency: the app listens on port 0 and the test calls it
 * with the platform `fetch`.
 */

const APP_SECRET = 'app-secret'

type Harness = {
  readonly url: string
  readonly accepted: { channel: Channel; message: IncomingMessage }[]
  readonly lines: Record<string, unknown>[]
  readonly close: () => Promise<void>
  setReady(value: boolean): void
  setQueueFull(value: boolean): void
}

async function serve(channels: readonly Channel[]): Promise<Harness> {
  const accepted: { channel: Channel; message: IncomingMessage }[] = []
  const { logger, lines } = collectingLogger()
  let ready = true
  let queueFull = false

  const app = createApp({
    channels,
    logger,
    maxBodyBytes: 1024,
    isReady: () => ready,
    enqueue: (channel, message) => {
      if (queueFull) return false
      accepted.push({ channel, message })
      return true
    },
  })

  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    accepted,
    lines,
    setReady: (value) => {
      ready = value
    },
    setQueueFull: (value) => {
      queueFull = value
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const whatsapp = createWhatsAppChannel({
  appSecret: APP_SECRET,
  verifyToken: 'verify-token',
  accessToken: 'token',
  phoneNumberId: '1',
  graphVersion: 'v26.0',
  timeoutMs: 1000,
  retries: 0,
})

function payload(text = 'hello', id = 'wamid.A'): string {
  return JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ id, from: '34600111222', type: 'text', text: { body: text } }] } }] }],
  })
}

function sign(body: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': `sha256=${hmacSha256Hex(APP_SECRET, Buffer.from(body, 'utf8'))}`,
  }
}

const harnesses: Harness[] = []
async function harness(channels: readonly Channel[] = [whatsapp]): Promise<Harness> {
  const created = await serve(channels)
  harnesses.push(created)
  return created
}

after(async () => {
  await Promise.all(harnesses.map((instance) => instance.close()))
})

describe('health endpoint', () => {
  it('answers 200 while the process is serving', async () => {
    const app = await harness()

    const response = await fetch(`${app.url}/healthz`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  })

  it('answers 503 once shutdown has begun', async () => {
    const app = await harness()
    app.setReady(false)

    const response = await fetch(`${app.url}/healthz`)

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { status: 'shutting_down' })
  })
})

describe('webhook handshake over http', () => {
  it('returns the challenge as plain text', async () => {
    const app = await harness()

    const response = await fetch(
      `${app.url}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123`,
    )

    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'abc123')
  })

  it('returns 403 for a wrong token', async () => {
    const app = await harness()

    const response = await fetch(
      `${app.url}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc`,
    )

    assert.equal(response.status, 403)
  })

  it('exposes no GET route for a channel without a handshake', async () => {
    const app = await harness([fakeChannel({ name: 'nohandshake' })])

    const response = await fetch(`${app.url}/webhooks/nohandshake`)

    assert.equal(response.status, 404)
  })
})

describe('webhook delivery over http', () => {
  it('accepts a signed delivery and queues the message', async () => {
    const app = await harness()
    const body = payload()

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: sign(body),
      body,
    })

    assert.equal(response.status, 200)
    assert.equal(app.accepted.length, 1)
    assert.equal(app.accepted[0]?.message.id, 'wamid.A')
  })

  it('answers before the work is done', async () => {
    // The regression this pins: the previous version called the model and sent
    // the reply before responding, so Meta saw a slow delivery and retried.
    const app = await harness()
    const body = payload()

    const startedAt = performance.now()
    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: sign(body),
      body,
    })
    const elapsed = performance.now() - startedAt

    assert.equal(response.status, 200)
    assert.ok(elapsed < 250, `acknowledged in ${Math.round(elapsed)}ms`)
  })

  it('rejects an unsigned delivery with 403 and queues nothing', async () => {
    const app = await harness()

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload(),
    })

    assert.equal(response.status, 403)
    assert.equal(app.accepted.length, 0)
  })

  it('rejects a delivery whose body changed after signing', async () => {
    const app = await harness()
    const headers = sign(payload('hello'))

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers,
      body: payload('goodbye'),
    })

    assert.equal(response.status, 403)
  })

  it('rejects a signed body that is not JSON with 400', async () => {
    const app = await harness()
    const body = 'not json at all'

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: sign(body),
      body,
    })

    assert.equal(response.status, 400)
  })

  it('accepts a signed delivery that carries no messages', async () => {
    const app = await harness()
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }] })

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: sign(body),
      body,
    })

    assert.equal(response.status, 200)
    assert.equal(app.accepted.length, 0)
  })

  it('verifies the signature before parsing, so a bad signature never reaches the parser', async () => {
    const app = await harness()

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
      body: '{"broken json',
    })

    assert.equal(response.status, 403, '403 rather than 400: it never got parsed')
  })

  it('rejects a body over the configured limit', async () => {
    const app = await harness()
    const body = JSON.stringify({ padding: 'x'.repeat(4096) })

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: sign(body),
      body,
    })

    assert.equal(response.status, 413)
    assert.equal(app.accepted.length, 0)

    // Handled by the app's own error handler, not Express's default, which
    // would have written a stack trace straight to stderr.
    const record = app.lines.at(-1)
    assert.equal(record?.['message'], 'rejected request')
    assert.equal(record?.['name'], 'PayloadTooLargeError')
    assert.equal(record?.['status'], 413)
  })

  it('answers 503 when the queue takes nothing, so the platform retries', async () => {
    const app = await harness()
    app.setQueueFull(true)
    const body = payload()

    const response = await fetch(`${app.url}/webhooks/whatsapp`, {
      method: 'POST',
      headers: sign(body),
      body,
    })

    assert.equal(response.status, 503)
  })

  it('never logs the text of a message', async () => {
    const app = await harness()
    const body = payload('a private sentence')

    await fetch(`${app.url}/webhooks/whatsapp`, { method: 'POST', headers: sign(body), body })

    const serialised = JSON.stringify(app.lines)
    assert.ok(!serialised.includes('a private sentence'), 'message bodies stay out of the log')
    assert.ok(!serialised.includes('34600111222'), 'and so do full phone numbers')
    assert.ok(serialised.includes('1222'), 'the redacted tail is still there to correlate')
  })
})
