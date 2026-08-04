/**
 * The one place that talks HTTP to the outside. Every outbound call gets a
 * timeout, because a hung socket with no deadline holds a worker slot forever.
 *
 * Built on the platform `fetch` and `AbortSignal.timeout`, so the project ships
 * no HTTP client dependency.
 */

export class HttpError extends Error {
  readonly status: number
  readonly body: string
  readonly retryAfterMs: number | null

  constructor(status: number, body: string, retryAfterMs: number | null) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
    this.retryAfterMs = retryAfterMs
  }
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

export type FetchJsonOptions = {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly timeoutMs: number
  /** Extra attempts after the first. 0 means a single attempt. */
  readonly retries?: number
  /** First backoff step. Each further attempt doubles it. */
  readonly baseDelayMs?: number
  /** Injected so tests do not spend real time backing off. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Injected so tests do not reach the network. */
  readonly fetchImpl?: typeof fetch
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** 429 and 5xx are worth another attempt. 4xx means the request itself is wrong. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Honouring it
 * matters: both providers rate limit, and backing off on our own schedule
 * while they told us exactly when to return is how a 429 turns into a ban.
 */
function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null

  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(header)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

export async function fetchJson(options: FetchJsonOptions): Promise<unknown> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeoutMs,
    retries = 0,
    baseDelayMs = 250,
    sleep = defaultSleep,
    fetchImpl = fetch,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method,
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Date.now())
        throw new HttpError(response.status, text.slice(0, 512), retryAfterMs)
      }

      return await response.json()
    } catch (error) {
      lastError = normalize(error, timeoutMs)

      const retryable =
        lastError instanceof TimeoutError ||
        (lastError instanceof HttpError && isRetryableStatus(lastError.status)) ||
        (lastError instanceof Error && lastError.name === 'TypeError') // network failure

      if (!retryable || attempt === retries) break

      const suggested = lastError instanceof HttpError ? lastError.retryAfterMs : null
      await sleep(suggested ?? baseDelayMs * 2 ** attempt)
    }
  }

  throw lastError
}

function normalize(error: unknown, timeoutMs: number): unknown {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new TimeoutError(timeoutMs)
  }
  return error
}
