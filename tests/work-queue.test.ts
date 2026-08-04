import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWorkQueue } from '../src/infrastructure/work-queue.ts'

const noop = (): void => {}

/** A promise plus the handles to settle it from the test. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('work queue', () => {
  it('runs an enqueued task', async () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: noop })
    let ran = false

    assert.equal(
      queue.enqueue(async () => {
        ran = true
      }),
      true,
    )
    await queue.drain(1000)

    assert.equal(ran, true)
  })

  it('never runs more tasks at once than its concurrency allows', async () => {
    const queue = createWorkQueue({ concurrency: 2, maxPending: 10, onError: noop })
    const gate = deferred()
    let active = 0
    let peak = 0

    for (let i = 0; i < 6; i += 1) {
      queue.enqueue(async () => {
        active += 1
        peak = Math.max(peak, active)
        await gate.promise
        active -= 1
      })
    }

    assert.equal(queue.stats().active, 2)
    assert.equal(queue.stats().pending, 4)

    gate.resolve()
    await queue.drain(1000)

    assert.equal(peak, 2)
  })

  it('refuses work once the pending list is full', () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 2, onError: noop })
    const gate = deferred()
    const blocking = async (): Promise<void> => {
      await gate.promise
    }

    assert.equal(queue.enqueue(blocking), true, 'runs immediately')
    assert.equal(queue.enqueue(blocking), true, 'pending 1 of 2')
    assert.equal(queue.enqueue(blocking), true, 'pending 2 of 2')
    assert.equal(queue.enqueue(blocking), false, 'full, so the webhook can answer 503')

    gate.resolve()
  })

  it('reports what a task threw instead of swallowing it', async () => {
    const errors: unknown[] = []
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: (e) => errors.push(e) })

    queue.enqueue(async () => {
      throw new Error('boom')
    })
    await queue.drain(1000)

    assert.equal(errors.length, 1)
    assert.match(String(errors[0]), /boom/)
  })

  it('keeps working after a task throws', async () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: noop })
    let secondRan = false

    queue.enqueue(async () => {
      throw new Error('boom')
    })
    queue.enqueue(async () => {
      secondRan = true
    })
    await queue.drain(1000)

    assert.equal(secondRan, true)
  })

  it('drains work that was already accepted', async () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: noop })
    const done: number[] = []

    for (let i = 0; i < 3; i += 1) {
      queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        done.push(i)
      })
    }

    assert.equal(await queue.drain(1000), true)
    assert.deepEqual(done, [0, 1, 2], 'nothing accepted was dropped')
  })

  it('stops accepting once draining has started', async () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: noop })
    const draining = queue.drain(1000)

    assert.equal(
      queue.enqueue(async () => {}),
      false,
    )
    await draining
  })

  it('reports failure when work outlives the drain deadline', async () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: noop })
    const gate = deferred()

    queue.enqueue(async () => {
      await gate.promise
    })

    assert.equal(await queue.drain(20), false, 'the caller can exit non-zero')
    gate.resolve()
  })

  it('drains immediately when there is nothing to do', async () => {
    const queue = createWorkQueue({ concurrency: 1, maxPending: 10, onError: noop })

    assert.equal(await queue.drain(1000), true)
  })
})
