import type { AiProvider, Channel, ProcessedMessages } from '../domain/ports.ts'
import type { IncomingMessage } from '../domain/types.ts'

/**
 * The one use case: answer an incoming message.
 *
 * It does not log. It returns what happened and lets the caller decide how to
 * record it, which keeps the tests asserting on outcomes instead of spying on
 * a logger. Failures to deliver are not outcomes, they propagate: the worker
 * that drives this owns the retry and the error log.
 */

export type ReplyOutcome =
  /** Already handled. A platform retry, or the same delivery twice. */
  | { readonly status: 'duplicate' }
  /** Not a text message, answered with the canned notice. */
  | { readonly status: 'unsupported' }
  /** Answered. `usedFallback` is true when the model failed and the canned reply went out instead. */
  | { readonly status: 'answered'; readonly usedFallback: boolean }

export type ReplyToMessage = (
  channel: Channel,
  message: IncomingMessage,
) => Promise<ReplyOutcome>

export type ReplyToMessageDeps = {
  readonly ai: AiProvider
  readonly processed: ProcessedMessages
  /** Sent when the model fails or returns nothing usable. */
  readonly fallbackText: string
  /** Sent when the message is not text. */
  readonly unsupportedText: string
}

export function createReplyToMessage(deps: ReplyToMessageDeps): ReplyToMessage {
  const { ai, processed, fallbackText, unsupportedText } = deps

  return async function replyToMessage(channel, message) {
    // Namespaced by channel: `update_id` on Telegram is a small integer and
    // would collide with nothing on WhatsApp today, but a bare id is a bug
    // waiting for the third adapter.
    if (!processed.claim(`${message.channel}:${message.id}`)) {
      return { status: 'duplicate' }
    }

    if (message.kind === 'unsupported') {
      await channel.send(message.conversationId, unsupportedText)
      return { status: 'unsupported' }
    }

    let answer: string
    let usedFallback = false

    try {
      answer = (await ai.reply(message.text)).trim()
    } catch {
      // No retry against the model on purpose: the user is already waiting,
      // and a canned answer now beats a better answer much later. Delivery is
      // the leg that retries, because a lost reply is the visible failure.
      answer = ''
    }

    if (answer === '') {
      answer = fallbackText
      usedFallback = true
    }

    await channel.send(message.conversationId, answer)
    return { status: 'answered', usedFallback }
  }
}
