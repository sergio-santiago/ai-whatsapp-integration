import type { Server } from 'node:http'
import { createReplyToMessage } from './application/reply-to-message.ts'
import type { AiProvider, Channel } from './domain/ports.ts'
import { createAi21Provider } from './infrastructure/ai/ai21.ts'
import { createOllamaProvider } from './infrastructure/ai/ollama.ts'
import { createTelegramChannel } from './infrastructure/channels/telegram.ts'
import { createWhatsAppChannel } from './infrastructure/channels/whatsapp.ts'
import { type Config, ConfigError, loadConfig } from './infrastructure/config.ts'
import { createApp } from './infrastructure/http/server.ts'
import { createLogger, redact } from './infrastructure/logger.ts'
import { createInMemoryProcessedMessages } from './infrastructure/processed-messages.ts'
import { createWorkQueue } from './infrastructure/work-queue.ts'

/**
 * Composition root. The only file that knows which adapter is behind which
 * port, and the only one allowed to read the environment.
 *
 * Wiring is three function calls and no container: with three ports, a DI
 * framework would be more machinery than the thing it wires.
 */

function buildAiProvider(config: Config): AiProvider {
  const { ai } = config

  if (ai.provider === 'ollama') {
    // Non-null by construction: loadConfig fills exactly one of the two.
    const ollama = ai.ollama as NonNullable<typeof ai.ollama>
    return createOllamaProvider({
      baseUrl: ollama.baseUrl,
      model: ollama.model,
      systemPrompt: ai.systemPrompt,
      timeoutMs: ai.timeoutMs,
    })
  }

  const ai21 = ai.ai21 as NonNullable<typeof ai.ai21>
  return createAi21Provider({
    apiKey: ai21.apiKey,
    model: ai21.model,
    maxTokens: ai21.maxTokens,
    temperature: ai21.temperature,
    systemPrompt: ai.systemPrompt,
    timeoutMs: ai.timeoutMs,
  })
}

function buildChannels(config: Config): readonly Channel[] {
  const channels: Channel[] = []
  const { send } = config

  if (config.channels.whatsapp !== null) {
    channels.push(
      createWhatsAppChannel({
        ...config.channels.whatsapp,
        timeoutMs: send.timeoutMs,
        retries: send.retries,
      }),
    )
  }

  if (config.channels.telegram !== null) {
    channels.push(
      createTelegramChannel({
        ...config.channels.telegram,
        timeoutMs: send.timeoutMs,
        retries: send.retries,
      }),
    )
  }

  return channels
}

/** Errors reach the log as a name and a message, never as a whole object. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

function main(): void {
  let config: Config
  try {
    config = loadConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`)
      process.exit(1)
    }
    throw error
  }

  let shuttingDown = false

  const logger = createLogger({ level: config.logLevel })
  const ai = buildAiProvider(config)
  const channels = buildChannels(config)
  const processed = createInMemoryProcessedMessages(config.dedup)

  const replyToMessage = createReplyToMessage({
    ai,
    processed,
    fallbackText: config.ai.fallbackText,
    unsupportedText: config.ai.unsupportedText,
  })

  const queue = createWorkQueue({
    concurrency: config.queue.concurrency,
    maxPending: config.queue.maxPending,
    onError: (error) => logger.error('unhandled worker error', { error: describeError(error) }),
  })

  const app = createApp({
    channels,
    logger,
    maxBodyBytes: config.maxBodyBytes,
    isReady: () => !shuttingDown,
    enqueue: (channel, message) =>
      queue.enqueue(async () => {
        const startedAt = performance.now()
        const log = logger.child({
          channel: message.channel,
          messageId: message.id,
          conversation: redact(message.conversationId),
        })

        try {
          const outcome = await replyToMessage(channel, message)
          log.info('message handled', {
            outcome: outcome.status,
            ...(outcome.status === 'answered' ? { usedFallback: outcome.usedFallback } : {}),
            durationMs: Math.round(performance.now() - startedAt),
          })
        } catch (error) {
          log.error('failed to handle message', {
            error: describeError(error),
            durationMs: Math.round(performance.now() - startedAt),
          })
        }
      }),
  })

  const server: Server = app.listen(config.port, () => {
    logger.info('listening', {
      port: config.port,
      channels: channels.map((channel) => channel.name),
      aiProvider: ai.name,
    })
  })

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    logger.info('shutting down', { signal, ...queue.stats() })

    // /healthz answers 503 from here on. The grace period is what makes that
    // observable: close the listener straight away and a health check gets a
    // refused connection instead of a 503, so nothing upstream ever learns the
    // instance is draining.
    if (config.shutdown.graceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.shutdown.graceMs))
    }

    server.close()
    // close() only stops new connections. Keep-alive sockets sitting idle
    // would hold the process open until their own timeout.
    server.closeIdleConnections()

    const drained = await queue.drain(config.shutdown.drainMs)

    if (!drained) {
      logger.error('shutdown timed out with work in flight', queue.stats())
    }

    logger.info('stopped')
    process.exit(drained ? 0 : 1)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main()
