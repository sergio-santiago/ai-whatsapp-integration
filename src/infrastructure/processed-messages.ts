import type { ProcessedMessages } from '../domain/ports.ts'

/**
 * Deduplication for a single instance.
 *
 * Bounded on both axes on purpose. A TTL alone is a leak: Meta retries an
 * unacknowledged delivery for up to 36 hours, so a window wide enough to cover
 * that is also wide enough for a traffic spike to grow the map without limit.
 * The entry cap makes the worst case a fixed amount of memory, and eviction is
 * oldest-first because a duplicate almost always arrives within seconds of the
 * original.
 *
 * Run more than one replica and this stops working: each one keeps its own
 * map, so the same message can be answered once per replica. That is the whole
 * reason `ProcessedMessages` is a port. Swapping this for Redis `SET NX EX` is
 * one adapter, and nothing else in the codebase changes.
 */

export type InMemoryProcessedMessagesOptions = {
  readonly ttlMs: number
  readonly maxEntries: number
  /** Defaults to the monotonic clock. Tests pass their own. */
  readonly now?: () => number
}

export function createInMemoryProcessedMessages(
  options: InMemoryProcessedMessagesOptions,
): ProcessedMessages & { readonly size: () => number } {
  const { ttlMs, maxEntries } = options
  const now = options.now ?? (() => Date.now())

  // A Map iterates in insertion order, which makes the first key the oldest.
  const seen = new Map<string, number>()

  function evictExpired(at: number): void {
    for (const [key, expiresAt] of seen) {
      if (expiresAt > at) break // insertion order means the rest are newer
      seen.delete(key)
    }
  }

  return {
    claim(key) {
      const at = now()
      evictExpired(at)

      if (seen.has(key)) return false

      seen.set(key, at + ttlMs)

      while (seen.size > maxEntries) {
        const oldest = seen.keys().next()
        if (oldest.done) break
        seen.delete(oldest.value)
      }

      return true
    },

    size: () => seen.size,
  }
}
