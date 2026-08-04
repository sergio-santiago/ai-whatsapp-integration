import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTelegramChannel } from '../src/infrastructure/channels/telegram.ts'
import { stubFetch } from './support/doubles.ts'

const SECRET = 'webhook-secret'

function channel(fetchImpl?: typeof fetch) {
  return createTelegramChannel({
    botToken: '123:ABC',
    webhookSecret: SECRET,
    timeoutMs: 1000,
    retries: 0,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })
}

const EMPTY_BODY = Buffer.alloc(0)

describe('telegram channel: authentication', () => {
  it('accepts the configured secret', () => {
    assert.equal(
      channel().authenticate({
        rawBody: EMPTY_BODY,
        headers: { 'x-telegram-bot-api-secret-token': SECRET },
      }),
      true,
    )
  })

  it('rejects a missing header', () => {
    assert.equal(channel().authenticate({ rawBody: EMPTY_BODY, headers: {} }), false)
  })

  it('rejects a wrong secret', () => {
    assert.equal(
      channel().authenticate({
        rawBody: EMPTY_BODY,
        headers: { 'x-telegram-bot-api-secret-token': 'nope' },
      }),
      false,
    )
  })

  it('rejects a secret that is a prefix of the real one', () => {
    assert.equal(
      channel().authenticate({
        rawBody: EMPTY_BODY,
        headers: { 'x-telegram-bot-api-secret-token': SECRET.slice(0, -1) },
      }),
      false,
    )
  })

  it('does not depend on the body, unlike the HMAC channel', () => {
    // Telegram authenticates the caller, not the payload. Worth pinning down:
    // it is the reason the port exposes `authenticate(request)` rather than
    // `verifySignature(body, signature)`.
    assert.equal(
      channel().authenticate({
        rawBody: Buffer.from('anything at all', 'utf8'),
        headers: { 'x-telegram-bot-api-secret-token': SECRET },
      }),
      true,
    )
  })
})

describe('telegram channel: no handshake', () => {
  it('does not expose a handshake at all', () => {
    // Telegram registers its webhook through setWebhook, so there is no GET to
    // answer. The port makes that member optional rather than forcing this
    // adapter to fake one.
    assert.equal(channel().handshake, undefined)
  })
})

describe('telegram channel: parsing', () => {
  it('reads a text message and replies to the chat, not the sender', () => {
    const update = {
      update_id: 700,
      message: {
        message_id: 9,
        from: { id: 111 },
        chat: { id: 222 },
        text: 'hello',
      },
    }

    assert.deepEqual(channel().parse(update), [
      { kind: 'text', channel: 'telegram', id: '700', conversationId: '222', text: 'hello' },
    ])
  })

  it('turns the numeric update_id into a string id', () => {
    const [message] = channel().parse({ update_id: 1, message: { chat: { id: 2 }, text: 'x' } })

    assert.equal(message?.id, '1')
    assert.equal(typeof message?.id, 'string')
  })

  it('names the media type of a non-text message', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ photo: [{ file_id: 'p' }] }, 'photo'],
      [{ sticker: { file_id: 's' } }, 'sticker'],
      [{ voice: { file_id: 'v' } }, 'voice'],
      [{ location: { latitude: 0, longitude: 0 } }, 'location'],
      [{ document: { file_id: 'd' } }, 'document'],
    ]

    for (const [extra, expected] of cases) {
      const [message] = channel().parse({ update_id: 1, message: { chat: { id: 2 }, ...extra } })

      assert.equal(message?.kind, 'unsupported')
      assert.equal(message?.kind === 'unsupported' ? message.mediaType : null, expected)
    }
  })

  it('falls back to unknown for a message with nothing recognisable', () => {
    const [message] = channel().parse({ update_id: 1, message: { chat: { id: 2 } } })

    assert.equal(message?.kind === 'unsupported' ? message.mediaType : null, 'unknown')
  })

  it('yields nothing for updates that are not messages', () => {
    const cases = [
      { update_id: 1, edited_message: { chat: { id: 2 }, text: 'edited' } },
      { update_id: 1, callback_query: { id: 'q' } },
      { update_id: 1, channel_post: { chat: { id: 2 }, text: 'post' } },
    ]

    for (const update of cases) {
      assert.deepEqual(channel().parse(update), [], JSON.stringify(update))
    }
  })

  it('yields nothing for payloads that are not the documented shape', () => {
    for (const payload of [null, 'string', 42, [], {}, { message: { chat: { id: 1 }, text: 'x' } }]) {
      assert.deepEqual(channel().parse(payload), [], JSON.stringify(payload))
    }
  })

  it('yields nothing when the chat id is missing', () => {
    assert.deepEqual(channel().parse({ update_id: 1, message: { text: 'orphan' } }), [])
  })
})

describe('telegram channel: sending', () => {
  it('posts to sendMessage with the bot token in the path', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { ok: true } }])

    await channel(fetchImpl).send('222', 'hello there')

    assert.equal(calls[0]?.url, 'https://api.telegram.org/bot123:ABC/sendMessage')
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      chat_id: '222',
      text: 'hello there',
    })
  })

  it('sends no authorization header, because the credential is the URL', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { ok: true } }])

    await channel(fetchImpl).send('222', 'hello')

    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], undefined)
  })

  it('truncates a reply longer than the platform limit', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { ok: true } }])

    await channel(fetchImpl).send('222', 'x'.repeat(5000))

    const body = JSON.parse(String(calls[0]?.init?.body)) as { text: string }
    assert.equal(body.text.length, 4096)
  })

  it('propagates a delivery failure', async () => {
    const { fetchImpl } = stubFetch([{ status: 401, body: { ok: false } }])

    await assert.rejects(() => channel(fetchImpl).send('222', 'hello'))
  })
})
