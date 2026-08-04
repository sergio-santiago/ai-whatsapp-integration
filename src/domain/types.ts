/**
 * What the application knows about a message, independent of the platform it
 * arrived from. Nothing here mentions WhatsApp, Telegram or HTTP on purpose:
 * the shape of each provider's payload is a detail of its adapter.
 */

type MessageBase = {
  /** Name of the channel the message came from. Used for logging and dedup. */
  readonly channel: string
  /** Platform-unique id of this delivery. `wamid` on WhatsApp, `update_id` on Telegram. */
  readonly id: string
  /**
   * Where a reply must be sent. Deliberately not called `from`: WhatsApp
   * replies to the sender's number, Telegram replies to `chat.id`, and in a
   * group those are two different things.
   */
  readonly conversationId: string
}

/** A text message the model can answer. */
export type TextMessage = MessageBase & {
  readonly kind: 'text'
  readonly text: string
}

/**
 * A message of a type the bot cannot answer: an image, a sticker, a voice
 * note, a location. Kept as a case of its own rather than dropped, so the
 * sender gets an answer instead of silence.
 */
export type UnsupportedMessage = MessageBase & {
  readonly kind: 'unsupported'
  readonly mediaType: string
}

export type IncomingMessage = TextMessage | UnsupportedMessage
