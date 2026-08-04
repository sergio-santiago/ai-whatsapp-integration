/**
 * The gap between acknowledging a webhook and doing the work.
 *
 * Platforms retry any delivery they do not see acknowledged quickly, so the
 * HTTP handler answers 200 and hands the message here. Without a bound that
 * would be an unlimited number of concurrent model calls during a burst, so
 * this caps how many run at once and how many can wait.
 *
 * The honest limitation, stated in the README as well: this is memory. If the
 * process is killed, whatever it was holding is gone, and the platform will
 * not retry a delivery it already saw acknowledged. `drain` on SIGTERM makes
 * an orderly shutdown lose nothing; a `kill -9` still does. Durability across
 * restarts means a broker, and that is a different project.
 */

export type Task = () => Promise<void>

export type WorkQueueOptions = {
  /** Tasks running at the same time. */
  readonly concurrency: number
  /** Tasks allowed to wait. Beyond this, `enqueue` refuses. */
  readonly maxPending: number
  /** Called for anything a task throws, so no rejection is swallowed. */
  readonly onError: (error: unknown) => void
}

export type WorkQueue = {
  /** False when the queue is full or already closing. */
  enqueue(task: Task): boolean
  /** Stops accepting, waits for in-flight and pending work, resolves false on timeout. */
  drain(timeoutMs: number): Promise<boolean>
  readonly stats: () => { readonly pending: number; readonly active: number }
}

export function createWorkQueue(options: WorkQueueOptions): WorkQueue {
  const { concurrency, maxPending, onError } = options

  const pending: Task[] = []
  let active = 0
  let closing = false
  let onIdle: (() => void) | null = null

  function pump(): void {
    while (active < concurrency && pending.length > 0) {
      const task = pending.shift()
      if (task === undefined) break

      active += 1
      void task()
        .catch(onError)
        .finally(() => {
          active -= 1
          pump()
          if (active === 0 && pending.length === 0 && onIdle !== null) onIdle()
        })
    }
  }

  return {
    enqueue(task) {
      if (closing || pending.length >= maxPending) return false
      pending.push(task)
      pump()
      return true
    },

    async drain(timeoutMs) {
      closing = true
      if (active === 0 && pending.length === 0) return true

      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          onIdle = null
          resolve(false)
        }, timeoutMs)

        onIdle = () => {
          clearTimeout(timer)
          onIdle = null
          resolve(true)
        }
      })
    },

    stats: () => ({ pending: pending.length, active }),
  }
}
