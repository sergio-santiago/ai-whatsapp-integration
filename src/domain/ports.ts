import type { IncomingMessage } from './types.ts'

/**
 * The three ports the application drives. Implementations live under
 * `src/infrastructure/`, and the test doubles under `tests/support/`.
 *
 * No port takes an AbortSignal: cancellation belongs to a concrete transport,
 * so every adapter owns its timeout and receives it when it is constructed.
 */

/** An inbound webhook request, before anything has been parsed or trusted. */
export type RawRequest = {
  /** The body exactly as it arrived. Signatures are computed over these bytes. */
  readonly rawBody: Buffer
  readonly headers: Readonly<Record<string, string | undefined>>
}

/** The answer to a platform's webhook registration handshake. */
export type HandshakeResult = {
  readonly status: number
  readonly body: string
}

/**
 * A messaging platform: how to trust its requests, how to read them and how to
 * answer them.
 *
 * The two implementations disagree on every one of those, which is why this is
 * a port and not a shared base class. WhatsApp signs the body with HMAC
 * SHA-256 and registers its webhook through a GET handshake; Telegram sends a
 * shared secret in a header and has no handshake at all.
 */
export interface Channel {
  /** Identifies the adapter in logs, dedup keys and the webhook path. */
  readonly name: string

  /** Constant-time authenticity check. False rejects the request with a 403. */
  authenticate(request: RawRequest): boolean

  /**
   * Extracts every message carried by an already authenticated payload.
   * A single delivery can carry more than one, and payloads that carry none
   * (delivery receipts, read receipts, edits) yield an empty list.
   */
  parse(body: unknown): readonly IncomingMessage[]

  /** Delivers a reply. Throws if delivery fails. */
  send(conversationId: string, text: string): Promise<void>

  /**
   * Answers the platform's webhook registration handshake, if it has one.
   * WhatsApp echoes `hub.challenge`; Telegram omits this member entirely.
   */
  handshake?(query: Readonly<Record<string, string | undefined>>): HandshakeResult
}

/** Turns a user prompt into an answer. Throws if the provider fails. */
export interface AiProvider {
  /** Identifies the adapter in logs. Not a display name. */
  readonly name: string
  reply(prompt: string): Promise<string>
}

/**
 * Remembers which deliveries have already been handled.
 *
 * `claim` is one operation on purpose. A `has` followed by an `add` leaves a
 * window between the check and the write, and platforms retry an
 * unacknowledged delivery immediately, so two copies of the same message can
 * be in flight at the same time.
 */
export interface ProcessedMessages {
  /** Returns true if this key had not been seen before, and marks it. */
  claim(key: string): boolean
}
