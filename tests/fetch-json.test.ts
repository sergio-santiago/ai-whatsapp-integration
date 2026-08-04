import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchJson, HttpError, TimeoutError } from '../src/infrastructure/fetch-json.ts'
import { recordingSleep, stubFetch } from './support/doubles.ts'

describe('fetchJson', () => {
  it('returns the decoded body on success', async () => {
    const { fetchImpl } = stubFetch([{ body: { ok: true } }])

    const result = await fetchJson({ url: 'https://example.test/x', timeoutMs: 100, fetchImpl })

    assert.deepEqual(result, { ok: true })
  })

  it('sends a JSON content type only when there is a body', async () => {
    const withBody = stubFetch([{ body: {} }])
    await fetchJson({ url: 'https://example.test/x', body: { a: 1 }, timeoutMs: 100, fetchImpl: withBody.fetchImpl })
    assert.equal(
      (withBody.calls[0]?.init?.headers as Record<string, string>)['content-type'],
      'application/json',
    )

    const withoutBody = stubFetch([{ body: {} }])
    await fetchJson({ url: 'https://example.test/x', method: 'GET', timeoutMs: 100, fetchImpl: withoutBody.fetchImpl })
    assert.equal(
      (withoutBody.calls[0]?.init?.headers as Record<string, string>)['content-type'],
      undefined,
    )
  })

  it('attaches an abort signal to every request', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: {} }])

    await fetchJson({ url: 'https://example.test/x', timeoutMs: 50, fetchImpl })

    assert.ok(calls[0]?.init?.signal instanceof AbortSignal, 'no call goes out without a deadline')
  })

  it('turns a timeout into a TimeoutError', async () => {
    const aborted = new Error('aborted')
    aborted.name = 'TimeoutError'
    const { fetchImpl } = stubFetch([{ throws: aborted }])

    await assert.rejects(
      () => fetchJson({ url: 'https://example.test/x', timeoutMs: 10, fetchImpl }),
      TimeoutError,
    )
  })

  it('really does abort a request that outlives its timeout', async () => {
    // Not a stub: this exercises AbortSignal.timeout against a real pending
    // request, which is the mechanism the adapters depend on.
    const hang = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'TimeoutError'
          reject(error)
        })
      })) as typeof fetch

    await assert.rejects(
      () => fetchJson({ url: 'https://example.test/slow', timeoutMs: 25, fetchImpl: hang }),
      TimeoutError,
    )
  })

  it('reports a non-2xx as an HttpError carrying the status', async () => {
    const { fetchImpl } = stubFetch([{ status: 404, body: { error: 'nope' } }])

    await assert.rejects(
      () => fetchJson({ url: 'https://example.test/x', timeoutMs: 100, fetchImpl }),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    )
  })

  it('makes a single attempt when no retries are configured', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 500 }])

    await assert.rejects(() => fetchJson({ url: 'https://example.test/x', timeoutMs: 100, fetchImpl }))

    assert.equal(calls.length, 1)
  })

  it('retries a 500 and returns the eventual success', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 500 }, { status: 500 }, { body: { ok: true } }])
    const { sleep, waits } = recordingSleep()

    const result = await fetchJson({
      url: 'https://example.test/x',
      timeoutMs: 100,
      retries: 2,
      baseDelayMs: 100,
      sleep,
      fetchImpl,
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(calls.length, 3)
    assert.deepEqual(waits, [100, 200], 'backoff doubles')
  })

  it('does not retry a 4xx, because the request itself is wrong', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 400 }])

    await assert.rejects(() =>
      fetchJson({ url: 'https://example.test/x', timeoutMs: 100, retries: 3, fetchImpl }),
    )

    assert.equal(calls.length, 1)
  })

  it('honours Retry-After in seconds on a 429 instead of its own backoff', async () => {
    const { fetchImpl } = stubFetch([
      { status: 429, headers: { 'retry-after': '7' } },
      { body: { ok: true } },
    ])
    const { sleep, waits } = recordingSleep()

    await fetchJson({
      url: 'https://example.test/x',
      timeoutMs: 100,
      retries: 1,
      baseDelayMs: 50,
      sleep,
      fetchImpl,
    })

    assert.deepEqual(waits, [7000], 'the provider said when to come back')
  })

  it('falls back to its own backoff when Retry-After is unparseable', async () => {
    const { fetchImpl } = stubFetch([
      { status: 429, headers: { 'retry-after': 'soon-ish' } },
      { body: { ok: true } },
    ])
    const { sleep, waits } = recordingSleep()

    await fetchJson({
      url: 'https://example.test/x',
      timeoutMs: 100,
      retries: 1,
      baseDelayMs: 40,
      sleep,
      fetchImpl,
    })

    assert.deepEqual(waits, [40])
  })

  it('retries a network failure', async () => {
    const networkError = new TypeError('fetch failed')
    const { fetchImpl, calls } = stubFetch([{ throws: networkError }, { body: { ok: true } }])
    const { sleep } = recordingSleep()

    await fetchJson({ url: 'https://example.test/x', timeoutMs: 100, retries: 1, sleep, fetchImpl })

    assert.equal(calls.length, 2)
  })

  it('gives up with the last error once retries run out', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 503 }])
    const { sleep } = recordingSleep()

    await assert.rejects(
      () => fetchJson({ url: 'https://example.test/x', timeoutMs: 100, retries: 2, sleep, fetchImpl }),
      (error: unknown) => error instanceof HttpError && error.status === 503,
    )

    assert.equal(calls.length, 3, 'the first attempt plus two retries')
  })
})
