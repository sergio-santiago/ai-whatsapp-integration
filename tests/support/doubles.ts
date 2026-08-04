import type { AiProvider, Channel, HandshakeResult, RawRequest } from '../../src/domain/ports.ts'
import type { IncomingMessage } from '../../src/domain/types.ts'
import { createLogger, type Logger } from '../../src/infrastructure/logger.ts'

/**
 * Test doubles, one per port.
 *
 * These are the second implementation of every port that the production
 * adapters do not provide on their own, and the reason the use case can be
 * tested without a network, a clock or an API key.
 */

export type FakeAiProvider = AiProvider & {
  readonly prompts: readonly string[]
}

export function fakeAiProvider(behaviour: {
  readonly answer?: string
  readonly fail?: Error
  readonly delayMs?: number
}): FakeAiProvider {
  const prompts: string[] = []

  return {
    name: 'fake-ai',
    prompts,
    async reply(prompt) {
      prompts.push(prompt)
      if (behaviour.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs))
      }
      if (behaviour.fail !== undefined) throw behaviour.fail
      return behaviour.answer ?? 'an answer'
    },
  }
}

export type SentMessage = { readonly to: string; readonly text: string }

export type FakeChannel = Channel & {
  readonly sent: readonly SentMessage[]
}

export function fakeChannel(options?: {
  readonly name?: string
  readonly authentic?: boolean
  readonly messages?: readonly IncomingMessage[]
  readonly failSend?: Error
  readonly handshake?: (query: Record<string, string | undefined>) => HandshakeResult
}): FakeChannel {
  const sent: SentMessage[] = []
  const name = options?.name ?? 'fake'

  const channel: FakeChannel = {
    name,
    sent,
    authenticate: (_request: RawRequest) => options?.authentic ?? true,
    parse: () => options?.messages ?? [],
    async send(to, text) {
      if (options?.failSend !== undefined) throw options.failSend
      sent.push({ to, text })
    },
  }

  if (options?.handshake !== undefined) {
    return { ...channel, handshake: options.handshake }
  }
  return channel
}

/** A logger that keeps its records instead of writing them. */
export function collectingLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  })
  return { logger, lines }
}

/** A clock the test moves by hand, so TTL and backoff cost no real time. */
export function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

/** Records what it was asked to wait for without ever waiting. */
export function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = []
  return {
    waits,
    sleep: async (ms) => {
      waits.push(ms)
    },
  }
}

export type StubResponse = {
  readonly status?: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
  readonly throws?: Error
}

export type StubbedFetch = {
  readonly fetchImpl: typeof fetch
  readonly calls: { url: string; init: RequestInit | undefined }[]
}

/** A `fetch` that answers from a queued script, so no test touches the network. */
export function stubFetch(responses: readonly StubResponse[]): StubbedFetch {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  let index = 0

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })

    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    if (response === undefined) throw new Error('stubFetch ran out of responses')
    if (response.throws !== undefined) throw response.throws

    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json', ...response.headers },
    })
  }) as typeof fetch

  return { fetchImpl, calls }
}
