import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Channel } from '../src/domain/ports.ts'
import { createTelegramChannel } from '../src/infrastructure/channels/telegram.ts'
import { createWhatsAppChannel } from '../src/infrastructure/channels/whatsapp.ts'
import { hmacSha256Hex } from '../src/infrastructure/signature.ts'
import { stubFetch } from './support/doubles.ts'

/**
 * One set of assertions run against every adapter.
 *
 * This is the file that decides whether `Channel` is a port or just Meta's
 * interface with a different name. Everything asserted here has to hold
 * regardless of how a platform authenticates, identifies a delivery or is
 * registered, and the per-adapter suites cover the parts that legitimately
 * differ.
 */

type Subject = {
  readonly label: string
  readonly build: (fetchImpl?: typeof fetch) => Channel
  /** A request the adapter must accept, carrying one text message. */
  readonly validRequest: () => { rawBody: Buffer; headers: Record<string, string> }
  readonly expectedConversationId: string
}

const WHATSAPP_SECRET = 'app-secret'
const TELEGRAM_SECRET = 'webhook-secret'

const whatsappBody = JSON.stringify({
  entry: [
    {
      changes: [
        { value: { messages: [{ id: 'wamid.A', from: '34600111222', type: 'text', text: { body: 'hello' } }] } },
      ],
    },
  ],
})

const telegramBody = JSON.stringify({
  update_id: 500,
  message: { message_id: 1, chat: { id: 987654321 }, text: 'hello' },
})

const SUBJECTS: readonly Subject[] = [
  {
    label: 'whatsapp',
    build: (fetchImpl) =>
      createWhatsAppChannel({
        appSecret: WHATSAPP_SECRET,
        verifyToken: 'verify',
        accessToken: 'token',
        phoneNumberId: '1',
        graphVersion: 'v26.0',
        timeoutMs: 1000,
        retries: 0,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
      }),
    validRequest: () => {
      const rawBody = Buffer.from(whatsappBody, 'utf8')
      return {
        rawBody,
        headers: { 'x-hub-signature-256': `sha256=${hmacSha256Hex(WHATSAPP_SECRET, rawBody)}` },
      }
    },
    expectedConversationId: '34600111222',
  },
  {
    label: 'telegram',
    build: (fetchImpl) =>
      createTelegramChannel({
        botToken: '1:A',
        webhookSecret: TELEGRAM_SECRET,
        timeoutMs: 1000,
        retries: 0,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
      }),
    validRequest: () => ({
      rawBody: Buffer.from(telegramBody, 'utf8'),
      headers: { 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET },
    }),
    expectedConversationId: '987654321',
  },
]

for (const subject of SUBJECTS) {
  describe(`channel contract: ${subject.label}`, () => {
    it('names itself', () => {
      assert.equal(subject.build().name, subject.label)
    })

    it('accepts a well-formed authenticated request', () => {
      assert.equal(subject.build().authenticate(subject.validRequest()), true)
    })

    it('rejects a request carrying no credentials at all', () => {
      const request = subject.validRequest()

      assert.equal(subject.build().authenticate({ rawBody: request.rawBody, headers: {} }), false)
    })

    it('rejects every header the other adapter would have accepted', () => {
      // Guards against an adapter accidentally trusting the wrong mechanism.
      const request = subject.validRequest()
      const foreign = SUBJECTS.filter((other) => other.label !== subject.label)

      for (const other of foreign) {
        assert.equal(
          subject.build().authenticate({ rawBody: request.rawBody, headers: other.validRequest().headers }),
          false,
        )
      }
    })

    it('extracts a text message tagged with its own channel name', () => {
      const request = subject.validRequest()
      const channel = subject.build()
      const messages = channel.parse(JSON.parse(request.rawBody.toString('utf8')))

      assert.equal(messages.length, 1)
      assert.equal(messages[0]?.kind, 'text')
      assert.equal(messages[0]?.channel, channel.name)
      assert.equal(messages[0]?.conversationId, subject.expectedConversationId)
      assert.equal(messages[0]?.kind === 'text' ? messages[0].text : null, 'hello')
    })

    it('gives every message a non-empty id', () => {
      const request = subject.validRequest()
      const messages = subject.build().parse(JSON.parse(request.rawBody.toString('utf8')))

      for (const message of messages) {
        assert.ok(message.id.length > 0, 'dedup depends on this')
      }
    })

    it('yields an empty list rather than throwing on any junk payload', () => {
      const channel = subject.build()

      for (const payload of [null, undefined, 0, '', 'text', [], {}, { entry: null }, { message: 1 }]) {
        assert.deepEqual(channel.parse(payload), [], `payload: ${JSON.stringify(payload)}`)
      }
    })

    it('truncates an over-long reply to the platform limit', async () => {
      const { fetchImpl, calls } = stubFetch([{ body: {} }])

      await subject.build(fetchImpl).send('someone', 'x'.repeat(9000))

      const sent = String(calls[0]?.init?.body)
      assert.ok(sent.includes('x'.repeat(4000)), 'the reply went out')
      assert.ok(!sent.includes('x'.repeat(4097)), 'but not past the limit')
    })

    it('sends the text unchanged when it is within the limit', async () => {
      const { fetchImpl, calls } = stubFetch([{ body: {} }])

      await subject.build(fetchImpl).send('someone', 'short reply')

      assert.ok(String(calls[0]?.init?.body).includes('short reply'))
    })

    it('rejects rather than swallowing a failed delivery', async () => {
      const { fetchImpl } = stubFetch([{ status: 500 }])

      await assert.rejects(() => subject.build(fetchImpl).send('someone', 'hello'))
    })

    it('puts a deadline on every outbound call', async () => {
      const { fetchImpl, calls } = stubFetch([{ body: {} }])

      await subject.build(fetchImpl).send('someone', 'hello')

      assert.ok(calls[0]?.init?.signal instanceof AbortSignal)
    })
  })
}

describe('channel contract: the adapters really do differ', () => {
  it('disagrees on whether a handshake exists', () => {
    const [whatsapp, telegram] = SUBJECTS.map((subject) => subject.build())

    assert.notEqual(whatsapp?.handshake, undefined)
    assert.equal(telegram?.handshake, undefined)
  })

  it('disagrees on whether authentication covers the body', () => {
    const [whatsapp, telegram] = SUBJECTS
    const tampered = Buffer.from('{"tampered":true}', 'utf8')

    // Same headers, different body: HMAC notices, a shared secret cannot.
    assert.equal(
      whatsapp?.build().authenticate({ rawBody: tampered, headers: whatsapp.validRequest().headers }),
      false,
    )
    assert.equal(
      telegram?.build().authenticate({ rawBody: tampered, headers: telegram.validRequest().headers }),
      true,
    )
  })
})
