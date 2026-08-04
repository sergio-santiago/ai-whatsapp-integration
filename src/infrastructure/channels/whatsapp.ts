import type { Channel, HandshakeResult, RawRequest } from '../../domain/ports.ts'
import type { IncomingMessage } from '../../domain/types.ts'
import { fetchJson } from '../fetch-json.ts'
import { asArray, asIdString, asRecord, asString } from '../json.ts'
import { hmacSha256Hex, safeEqual } from '../signature.ts'
import { truncate } from '../text.ts'

/**
 * WhatsApp Business, through the Meta Graph API.
 *
 * Three things here are specific to Meta and are the reason this adapter
 * exists at all: the body is signed with HMAC-SHA256 and the signature covers
 * the raw bytes, webhook registration is a GET handshake that echoes a
 * challenge, and a single delivery can carry several messages across several
 * entries.
 */

/** WhatsApp rejects a text body longer than this, so the model output is cut first. */
const MAX_TEXT_LENGTH = 4096

export type WhatsAppChannelOptions = {
  /** App Secret from the Meta app dashboard. Signs every inbound payload. */
  readonly appSecret: string
  /** Shared string echoed during webhook registration. */
  readonly verifyToken: string
  /** Bearer token for outbound sends. */
  readonly accessToken: string
  readonly phoneNumberId: string
  /** Graph API version, for example `v26.0`. Meta retires a version about two years after release. */
  readonly graphVersion: string
  readonly timeoutMs: number
  readonly retries: number
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}

export function createWhatsAppChannel(options: WhatsAppChannelOptions): Channel {
  const baseUrl = options.baseUrl ?? 'https://graph.facebook.com'
  const sendUrl = `${baseUrl}/${options.graphVersion}/${options.phoneNumberId}/messages`

  return {
    name: 'whatsapp',

    authenticate(request: RawRequest): boolean {
      const header = request.headers['x-hub-signature-256']
      if (header === undefined) return false

      const [algorithm, received] = header.split('=', 2)
      if (algorithm !== 'sha256' || received === undefined) return false

      return safeEqual(received, hmacSha256Hex(options.appSecret, request.rawBody))
    },

    handshake(query): HandshakeResult {
      const mode = query['hub.mode']
      const token = query['hub.verify_token']
      const challenge = query['hub.challenge']

      // The token is compared in constant time like any other secret, and the
      // mode has to be the one Meta documents rather than merely present.
      if (mode !== 'subscribe' || token === undefined || !safeEqual(token, options.verifyToken)) {
        return { status: 403, body: 'Forbidden' }
      }

      return { status: 200, body: challenge ?? '' }
    },

    parse(body: unknown): readonly IncomingMessage[] {
      const messages: IncomingMessage[] = []

      for (const entry of asArray(asRecord(body)?.['entry'])) {
        for (const change of asArray(asRecord(entry)?.['changes'])) {
          const value = asRecord(asRecord(change)?.['value'])
          // Status callbacks (sent, delivered, read) come through the same
          // webhook and carry no `messages`, so they fall out here.
          for (const raw of asArray(value?.['messages'])) {
            const message = toIncomingMessage(raw)
            if (message !== null) messages.push(message)
          }
        }
      }

      return messages
    },

    async send(conversationId: string, text: string): Promise<void> {
      await fetchJson({
        url: sendUrl,
        method: 'POST',
        headers: { authorization: `Bearer ${options.accessToken}` },
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversationId,
          type: 'text',
          text: { preview_url: false, body: truncate(text, MAX_TEXT_LENGTH) },
        },
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      })
    },
  }
}

function toIncomingMessage(raw: unknown): IncomingMessage | null {
  const record = asRecord(raw)
  if (record === null) return null

  const id = asString(record['id'])
  const from = asIdString(record['from'])
  if (id === null || from === null) return null

  const type = asString(record['type']) ?? 'unknown'
  const text = asString(asRecord(record['text'])?.['body'])

  // A sticker or a photo has no `text.body`. The old code sent the empty
  // string straight to the model; here it becomes an explicit case.
  if (type !== 'text' || text === null) {
    return { kind: 'unsupported', channel: 'whatsapp', id, conversationId: from, mediaType: type }
  }

  return { kind: 'text', channel: 'whatsapp', id, conversationId: from, text }
}
