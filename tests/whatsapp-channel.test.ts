import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWhatsAppChannel } from '../src/infrastructure/channels/whatsapp.ts'
import { hmacSha256Hex } from '../src/infrastructure/signature.ts'
import { stubFetch } from './support/doubles.ts'

const APP_SECRET = 'app-secret'
const VERIFY_TOKEN = 'verify-token'

function channel(fetchImpl?: typeof fetch) {
  return createWhatsAppChannel({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    accessToken: 'access-token',
    phoneNumberId: '555000',
    graphVersion: 'v26.0',
    timeoutMs: 1000,
    retries: 0,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })
}

function signed(body: string): { rawBody: Buffer; headers: Record<string, string> } {
  const rawBody = Buffer.from(body, 'utf8')
  return {
    rawBody,
    headers: { 'x-hub-signature-256': `sha256=${hmacSha256Hex(APP_SECRET, rawBody)}` },
  }
}

const TEXT_PAYLOAD = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.A', from: '34600111222', type: 'text', text: { body: 'hello' } }],
          },
        },
      ],
    },
  ],
})

describe('whatsapp channel: authentication', () => {
  it('accepts a correctly signed body', () => {
    assert.equal(channel().authenticate(signed(TEXT_PAYLOAD)), true)
  })

  it('rejects a request with no signature header', () => {
    assert.equal(
      channel().authenticate({ rawBody: Buffer.from(TEXT_PAYLOAD), headers: {} }),
      false,
    )
  })

  it('rejects a signature that does not match the body', () => {
    const request = signed(TEXT_PAYLOAD)

    assert.equal(
      channel().authenticate({
        ...request,
        headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
      }),
      false,
    )
  })

  it('rejects a body altered after signing, down to one byte', () => {
    const request = signed(TEXT_PAYLOAD)
    const tampered = Buffer.from(TEXT_PAYLOAD.replace('hello', 'hellp'), 'utf8')

    assert.equal(channel().authenticate({ ...request, rawBody: tampered }), false)
  })

  it('rejects a signature announced with the wrong algorithm', () => {
    const rawBody = Buffer.from(TEXT_PAYLOAD, 'utf8')

    assert.equal(
      channel().authenticate({
        rawBody,
        headers: { 'x-hub-signature-256': `sha1=${hmacSha256Hex(APP_SECRET, rawBody)}` },
      }),
      false,
    )
  })

  it('rejects a header with no algorithm prefix', () => {
    const rawBody = Buffer.from(TEXT_PAYLOAD, 'utf8')

    assert.equal(
      channel().authenticate({
        rawBody,
        headers: { 'x-hub-signature-256': hmacSha256Hex(APP_SECRET, rawBody) },
      }),
      false,
    )
  })

  it('rejects an empty body signed with the wrong secret', () => {
    const rawBody = Buffer.alloc(0)

    assert.equal(
      channel().authenticate({
        rawBody,
        headers: { 'x-hub-signature-256': `sha256=${hmacSha256Hex('other-secret', rawBody)}` },
      }),
      false,
    )
  })
})

describe('whatsapp channel: handshake', () => {
  it('echoes the challenge when the token matches', () => {
    const result = channel().handshake?.({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '12345',
    })

    assert.deepEqual(result, { status: 200, body: '12345' })
  })

  it('refuses a wrong token', () => {
    const result = channel().handshake?.({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '12345',
    })

    assert.equal(result?.status, 403)
  })

  it('refuses a missing token', () => {
    const result = channel().handshake?.({ 'hub.mode': 'subscribe', 'hub.challenge': '1' })

    assert.equal(result?.status, 403)
  })

  it('refuses a mode other than subscribe', () => {
    // The original only checked that hub.mode was present at all.
    const result = channel().handshake?.({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '1',
    })

    assert.equal(result?.status, 403)
  })
})

describe('whatsapp channel: parsing', () => {
  it('reads a text message', () => {
    assert.deepEqual(channel().parse(JSON.parse(TEXT_PAYLOAD)), [
      { kind: 'text', channel: 'whatsapp', id: 'wamid.A', conversationId: '34600111222', text: 'hello' },
    ])
  })

  it('reads every message across every entry and change', () => {
    // The original took entry[0].changes[0].value.messages[0] and dropped the rest.
    const payload = {
      entry: [
        {
          changes: [
            { value: { messages: [{ id: 'a', from: '1', type: 'text', text: { body: 'one' } }] } },
            { value: { messages: [{ id: 'b', from: '2', type: 'text', text: { body: 'two' } }] } },
          ],
        },
        {
          changes: [
            { value: { messages: [{ id: 'c', from: '3', type: 'text', text: { body: 'three' } }] } },
          ],
        },
      ],
    }

    assert.deepEqual(
      channel()
        .parse(payload)
        .map((message) => message.id),
      ['a', 'b', 'c'],
    )
  })

  it('classifies a sticker as unsupported instead of sending empty text to the model', () => {
    const payload = {
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.S', from: '34600', type: 'sticker', sticker: { id: 's' } }] } }] }],
    }

    assert.deepEqual(channel().parse(payload), [
      { kind: 'unsupported', channel: 'whatsapp', id: 'wamid.S', conversationId: '34600', mediaType: 'sticker' },
    ])
  })

  it('yields nothing for a delivery status callback', () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.A', status: 'read' }] } }] }] }

    assert.deepEqual(channel().parse(payload), [])
  })

  it('yields nothing for payloads that are not the documented shape', () => {
    for (const payload of [null, 'a string', 42, [], {}, { entry: 'nope' }, { entry: [{}] }]) {
      assert.deepEqual(channel().parse(payload), [], `payload: ${JSON.stringify(payload)}`)
    }
  })

  it('skips a message with no id or no sender', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: '34600', type: 'text', text: { body: 'no id' } },
                  { id: 'x', type: 'text', text: { body: 'no sender' } },
                  { id: 'ok', from: '34600', type: 'text', text: { body: 'fine' } },
                ],
              },
            },
          ],
        },
      ],
    }

    assert.deepEqual(
      channel()
        .parse(payload)
        .map((message) => message.id),
      ['ok'],
    )
  })

  it('treats a text type with no body as unsupported rather than crashing', () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: 'x', from: '1', type: 'text' }] } }] }] }

    assert.deepEqual(channel().parse(payload), [
      { kind: 'unsupported', channel: 'whatsapp', id: 'x', conversationId: '1', mediaType: 'text' },
    ])
  })
})

describe('whatsapp channel: sending', () => {
  it('posts to the configured graph version and phone number', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: {} }])

    await channel(fetchImpl).send('34600111222', 'hello there')

    assert.equal(calls[0]?.url, 'https://graph.facebook.com/v26.0/555000/messages')
    assert.equal(
      (calls[0]?.init?.headers as Record<string, string>)['authorization'],
      'Bearer access-token',
    )
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '34600111222',
      type: 'text',
      text: { preview_url: false, body: 'hello there' },
    })
  })

  it('truncates a reply longer than the platform limit', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: {} }])

    await channel(fetchImpl).send('34600', 'x'.repeat(5000))

    const body = JSON.parse(String(calls[0]?.init?.body)) as { text: { body: string } }
    assert.equal(body.text.body.length, 4096, 'WhatsApp rejects anything longer')
    assert.ok(body.text.body.endsWith('…'), 'the cut is visible')
  })

  it('propagates a delivery failure', async () => {
    const { fetchImpl } = stubFetch([{ status: 401, body: { error: 'bad token' } }])

    await assert.rejects(() => channel(fetchImpl).send('34600', 'hello'))
  })
})
