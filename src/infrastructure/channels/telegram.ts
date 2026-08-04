import type { Channel, RawRequest } from '../../domain/ports.ts'
import type { IncomingMessage } from '../../domain/types.ts'
import { fetchJson } from '../fetch-json.ts'
import { asArray, asIdString, asRecord, asString } from '../json.ts'
import { safeEqual } from '../signature.ts'
import { truncate } from '../text.ts'

/**
 * Telegram Bot API.
 *
 * Deliberately different from WhatsApp in every place the port touches, which
 * is what keeps `Channel` an abstraction rather than Meta's interface renamed:
 *
 * - authenticity is a shared secret in a header, not an HMAC over the body,
 * - there is no registration handshake, the webhook is set through an API call,
 *   so this adapter has no `handshake` member at all,
 * - the delivery id is `update_id`, an integer that counts up, not a string,
 * - a reply goes to `chat.id`, which in a group is not the sender's id.
 */

const MAX_TEXT_LENGTH = 4096

/** Fields whose presence tells us what a non-text message actually was. */
const MEDIA_FIELDS = [
  'photo',
  'sticker',
  'voice',
  'audio',
  'video',
  'video_note',
  'document',
  'animation',
  'location',
  'contact',
  'poll',
] as const

export type TelegramChannelOptions = {
  /** Token from @BotFather. Also the credential in the send URL. */
  readonly botToken: string
  /** The `secret_token` passed to setWebhook, echoed back in every request. */
  readonly webhookSecret: string
  readonly timeoutMs: number
  readonly retries: number
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}

export function createTelegramChannel(options: TelegramChannelOptions): Channel {
  const baseUrl = options.baseUrl ?? 'https://api.telegram.org'
  const sendUrl = `${baseUrl}/bot${options.botToken}/sendMessage`

  return {
    name: 'telegram',

    authenticate(request: RawRequest): boolean {
      const received = request.headers['x-telegram-bot-api-secret-token']
      if (received === undefined) return false
      return safeEqual(received, options.webhookSecret)
    },

    parse(body: unknown): readonly IncomingMessage[] {
      const update = asRecord(body)
      if (update === null) return []

      // One update carries at most one optional field. Edits, callback queries
      // and channel posts are not handled, and yield nothing.
      const id = asIdString(update['update_id'])
      const message = asRecord(update['message'])
      if (id === null || message === null) return []

      const conversationId = asIdString(asRecord(message['chat'])?.['id'])
      if (conversationId === null) return []

      const text = asString(message['text'])
      if (text !== null) {
        return [{ kind: 'text', channel: 'telegram', id, conversationId, text }]
      }

      return [
        {
          kind: 'unsupported',
          channel: 'telegram',
          id,
          conversationId,
          mediaType: detectMediaType(message),
        },
      ]
    },

    async send(conversationId: string, text: string): Promise<void> {
      await fetchJson({
        url: sendUrl,
        method: 'POST',
        body: { chat_id: conversationId, text: truncate(text, MAX_TEXT_LENGTH) },
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      })
    },
  }
}

function detectMediaType(message: Record<string, unknown>): string {
  for (const field of MEDIA_FIELDS) {
    const value = message[field]
    if (value === undefined) continue
    // `photo` is an array of sizes rather than an object.
    if (Array.isArray(value) && asArray(value).length === 0) continue
    return field
  }
  return 'unknown'
}
