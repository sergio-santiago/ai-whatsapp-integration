import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createReplyToMessage } from '../src/application/reply-to-message.ts'
import type { IncomingMessage } from '../src/domain/types.ts'
import { createInMemoryProcessedMessages } from '../src/infrastructure/processed-messages.ts'
import { fakeAiProvider, fakeChannel } from './support/doubles.ts'

const FALLBACK = 'fallback text'
const UNSUPPORTED = 'text only, please'

function textMessage(overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    kind: 'text',
    channel: 'fake',
    id: 'msg-1',
    conversationId: 'conv-1',
    text: 'hello',
    ...overrides,
  } as IncomingMessage
}

function build(ai = fakeAiProvider({ answer: 'the answer' })) {
  const processed = createInMemoryProcessedMessages({ ttlMs: 60_000, maxEntries: 100 })
  return { ai, processed, replyToMessage: createReplyToMessage({ ai, processed, fallbackText: FALLBACK, unsupportedText: UNSUPPORTED }) }
}

describe('reply to message', () => {
  it('answers a text message through the channel it arrived on', async () => {
    const { replyToMessage, ai } = build()
    const channel = fakeChannel()

    const outcome = await replyToMessage(channel, textMessage())

    assert.deepEqual(outcome, { status: 'answered', usedFallback: false })
    assert.deepEqual(channel.sent, [{ to: 'conv-1', text: 'the answer' }])
    assert.deepEqual(ai.prompts, ['hello'])
  })

  it('ignores a message it has already handled', async () => {
    const { replyToMessage } = build()
    const channel = fakeChannel()
    const message = textMessage()

    const first = await replyToMessage(channel, message)
    const second = await replyToMessage(channel, message)

    assert.equal(first.status, 'answered')
    assert.deepEqual(second, { status: 'duplicate' })
    assert.equal(channel.sent.length, 1, 'the retry produced no second answer')
  })

  it('claims the id before calling the model, so a duplicate costs nothing', async () => {
    const { replyToMessage, ai } = build()
    const channel = fakeChannel()

    await replyToMessage(channel, textMessage())
    await replyToMessage(channel, textMessage())

    assert.equal(ai.prompts.length, 1, 'the model was not asked twice')
  })

  it('falls back when the provider throws', async () => {
    const { replyToMessage } = build(fakeAiProvider({ fail: new Error('provider down') }))
    const channel = fakeChannel()

    const outcome = await replyToMessage(channel, textMessage())

    assert.deepEqual(outcome, { status: 'answered', usedFallback: true })
    assert.deepEqual(channel.sent, [{ to: 'conv-1', text: FALLBACK }])
  })

  it('falls back when the provider answers with nothing usable', async () => {
    const { replyToMessage } = build(fakeAiProvider({ answer: '   \n  ' }))
    const channel = fakeChannel()

    const outcome = await replyToMessage(channel, textMessage())

    assert.deepEqual(outcome, { status: 'answered', usedFallback: true })
    assert.deepEqual(channel.sent, [{ to: 'conv-1', text: FALLBACK }])
  })

  it('answers a non-text message without calling the model', async () => {
    const { replyToMessage, ai } = build()
    const channel = fakeChannel()

    const outcome = await replyToMessage(channel, {
      kind: 'unsupported',
      channel: 'fake',
      id: 'msg-2',
      conversationId: 'conv-1',
      mediaType: 'sticker',
    })

    assert.deepEqual(outcome, { status: 'unsupported' })
    assert.deepEqual(channel.sent, [{ to: 'conv-1', text: UNSUPPORTED }])
    assert.deepEqual(ai.prompts, [], 'a sticker never reaches the model')
  })

  it('lets a delivery failure propagate to the worker', async () => {
    // Delivery failures are not an outcome of the use case: the worker logs
    // them with the message context and the send adapter owns the retry.
    const { replyToMessage } = build()
    const channel = fakeChannel({ failSend: new Error('gateway down') })

    await assert.rejects(() => replyToMessage(channel, textMessage()), /gateway down/)
  })

  it('trims the answer before sending it', async () => {
    const { replyToMessage } = build(fakeAiProvider({ answer: '  padded answer \n' }))
    const channel = fakeChannel()

    await replyToMessage(channel, textMessage())

    assert.deepEqual(channel.sent, [{ to: 'conv-1', text: 'padded answer' }])
  })

  it('treats the same id on two channels as two different messages', async () => {
    const { replyToMessage } = build()
    const whatsapp = fakeChannel({ name: 'whatsapp' })
    const telegram = fakeChannel({ name: 'telegram' })

    const first = await replyToMessage(whatsapp, textMessage({ channel: 'whatsapp', id: '42' }))
    const second = await replyToMessage(telegram, textMessage({ channel: 'telegram', id: '42' }))

    assert.equal(first.status, 'answered')
    assert.equal(second.status, 'answered')
  })
})
