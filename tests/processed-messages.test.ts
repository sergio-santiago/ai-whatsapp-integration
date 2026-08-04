import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createInMemoryProcessedMessages } from '../src/infrastructure/processed-messages.ts'
import { fakeClock } from './support/doubles.ts'

describe('in-memory processed messages', () => {
  it('claims an unseen key once', () => {
    const store = createInMemoryProcessedMessages({ ttlMs: 1000, maxEntries: 10 })

    assert.equal(store.claim('whatsapp:wamid.A'), true)
    assert.equal(store.claim('whatsapp:wamid.A'), false)
    assert.equal(store.claim('whatsapp:wamid.A'), false)
  })

  it('keeps channels apart', () => {
    const store = createInMemoryProcessedMessages({ ttlMs: 1000, maxEntries: 10 })

    // Telegram's update_id is a small integer and will collide with another
    // channel's ids sooner or later. The namespace is what prevents a message
    // being silently swallowed as a duplicate of an unrelated one.
    assert.equal(store.claim('telegram:42'), true)
    assert.equal(store.claim('whatsapp:42'), true)
  })

  it('forgets a key once its ttl has passed', () => {
    const clock = fakeClock()
    const store = createInMemoryProcessedMessages({
      ttlMs: 1000,
      maxEntries: 10,
      now: clock.now,
    })

    assert.equal(store.claim('a'), true)

    clock.advance(999)
    assert.equal(store.claim('a'), false, 'still inside the window')

    clock.advance(2)
    assert.equal(store.claim('a'), true, 'expired, so it can be claimed again')
  })

  it('evicts the oldest entries when it reaches the cap', () => {
    const clock = fakeClock()
    const store = createInMemoryProcessedMessages({
      ttlMs: 60_000,
      maxEntries: 3,
      now: clock.now,
    })

    for (const key of ['a', 'b', 'c']) {
      clock.advance(1)
      store.claim(key)
    }
    assert.equal(store.size(), 3)

    clock.advance(1)
    store.claim('d')

    assert.equal(store.size(), 3, 'the cap holds')
    assert.equal(store.claim('a'), true, '"a" was evicted, so it looks new again')
    assert.equal(store.claim('d'), false, '"d" is the newest and survives')
  })

  it('stays bounded under a burst far larger than the cap', () => {
    // The failure this guards against is a TTL-only map: with a 36 hour window
    // and no cap, a spike grows memory without limit.
    const store = createInMemoryProcessedMessages({ ttlMs: 36 * 60 * 60 * 1000, maxEntries: 100 })

    for (let i = 0; i < 10_000; i += 1) store.claim(`key-${i}`)

    assert.equal(store.size(), 100)
  })

  it('drops expired entries even when the cap is never reached', () => {
    const clock = fakeClock()
    const store = createInMemoryProcessedMessages({
      ttlMs: 100,
      maxEntries: 1000,
      now: clock.now,
    })

    store.claim('a')
    store.claim('b')
    clock.advance(101)
    store.claim('c')

    assert.equal(store.size(), 1, 'a and b were purged on the next claim')
  })
})
