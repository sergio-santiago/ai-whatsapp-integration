import { isLogLevel, type LogLevel } from './logger.ts'

/**
 * Configuration is read once, validated once, and the process refuses to start
 * if anything is missing.
 *
 * The version this replaces read `process.env` straight into an object, so a
 * missing access token became a 401 on the first real message hours later. A
 * bad deploy should fail at boot, loudly, and list everything that is wrong at
 * once rather than one variable per restart.
 */

export class ConfigError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

export type WhatsAppConfig = {
  readonly appSecret: string
  readonly verifyToken: string
  readonly accessToken: string
  readonly phoneNumberId: string
  readonly graphVersion: string
}

export type TelegramConfig = {
  readonly botToken: string
  readonly webhookSecret: string
}

export type Ai21Config = {
  readonly apiKey: string
  readonly model: string
  readonly maxTokens: number
  readonly temperature: number
}

export type OllamaConfig = {
  readonly baseUrl: string
  readonly model: string
}

export type Config = {
  readonly port: number
  readonly logLevel: LogLevel
  /** Inbound bodies larger than this are rejected before any signature work. */
  readonly maxBodyBytes: number
  readonly channels: {
    readonly whatsapp: WhatsAppConfig | null
    readonly telegram: TelegramConfig | null
  }
  readonly ai: {
    readonly provider: 'ai21' | 'ollama'
    readonly systemPrompt: string
    readonly fallbackText: string
    readonly unsupportedText: string
    readonly timeoutMs: number
    readonly ai21: Ai21Config | null
    readonly ollama: OllamaConfig | null
  }
  readonly send: {
    readonly timeoutMs: number
    readonly retries: number
  }
  readonly dedup: {
    readonly ttlMs: number
    readonly maxEntries: number
  }
  readonly queue: {
    readonly concurrency: number
    readonly maxPending: number
  }
  readonly shutdown: {
    /**
     * Time between /healthz starting to answer 503 and the listener closing.
     * Zero is right on a laptop. Behind a load balancer it has to exceed the
     * health check interval, or the instance stops accepting connections
     * before anything notices it is going away.
     */
    readonly graceMs: number
    /** How long to wait for accepted work to finish once the listener is closed. */
    readonly drainMs: number
  }
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant answering inside a chat app. ' +
  'Reply in the same language the user writes in. Keep answers short and concrete.'

const DEFAULT_FALLBACK_TEXT = "Sorry, I can't answer right now. Please try again in a moment."

const DEFAULT_UNSUPPORTED_TEXT = 'I can only read text messages for now.'

export type Env = Readonly<Record<string, string | undefined>>

export function loadConfig(env: Env): Config {
  const problems: string[] = []

  function required(name: string): string {
    const value = env[name]?.trim()
    if (value === undefined || value === '') {
      problems.push(`${name} is required`)
      return ''
    }
    return value
  }

  function optional(name: string, fallback: string): string {
    const value = env[name]?.trim()
    return value === undefined || value === '' ? fallback : value
  }

  function integer(name: string, fallback: number, min: number): number {
    const raw = env[name]?.trim()
    if (raw === undefined || raw === '') return fallback

    const value = Number(raw)
    if (!Number.isInteger(value) || value < min) {
      problems.push(`${name} must be an integer >= ${min}, got ${JSON.stringify(raw)}`)
      return fallback
    }
    return value
  }

  function decimal(name: string, fallback: number, min: number, max: number): number {
    const raw = env[name]?.trim()
    if (raw === undefined || raw === '') return fallback

    const value = Number(raw)
    if (!Number.isFinite(value) || value < min || value > max) {
      problems.push(`${name} must be a number between ${min} and ${max}, got ${JSON.stringify(raw)}`)
      return fallback
    }
    return value
  }

  const enabled = optional('CHANNELS', 'whatsapp')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '')

  for (const name of enabled) {
    if (name !== 'whatsapp' && name !== 'telegram') {
      problems.push(`CHANNELS contains unknown channel ${JSON.stringify(name)}`)
    }
  }
  if (enabled.length === 0) {
    problems.push('CHANNELS must enable at least one channel')
  }

  const whatsapp: WhatsAppConfig | null = enabled.includes('whatsapp')
    ? {
        appSecret: required('WHATSAPP_APP_SECRET'),
        verifyToken: required('WHATSAPP_VERIFY_TOKEN'),
        accessToken: required('WHATSAPP_TOKEN'),
        phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
        graphVersion: optional('WHATSAPP_GRAPH_VERSION', 'v26.0'),
      }
    : null

  const telegram: TelegramConfig | null = enabled.includes('telegram')
    ? {
        botToken: required('TELEGRAM_BOT_TOKEN'),
        webhookSecret: required('TELEGRAM_WEBHOOK_SECRET'),
      }
    : null

  const providerName = optional('AI_PROVIDER', 'ai21').toLowerCase()
  if (providerName !== 'ai21' && providerName !== 'ollama') {
    problems.push(`AI_PROVIDER must be "ai21" or "ollama", got ${JSON.stringify(providerName)}`)
  }
  const provider = providerName === 'ollama' ? 'ollama' : 'ai21'

  const ai21: Ai21Config | null =
    provider === 'ai21'
      ? {
          apiKey: required('AI21_API_KEY'),
          model: optional('AI21_MODEL', 'jamba-large-1.7'),
          maxTokens: integer('AI21_MAX_TOKENS', 512, 1),
          temperature: decimal('AI21_TEMPERATURE', 0.7, 0, 2),
        }
      : null

  const ollama: OllamaConfig | null =
    provider === 'ollama'
      ? {
          baseUrl: optional('OLLAMA_BASE_URL', 'http://localhost:11434'),
          model: optional('OLLAMA_MODEL', 'llama3.2'),
        }
      : null

  const logLevelRaw = optional('LOG_LEVEL', 'info').toLowerCase()
  if (!isLogLevel(logLevelRaw)) {
    problems.push(`LOG_LEVEL must be debug, info, warn or error, got ${JSON.stringify(logLevelRaw)}`)
  }

  const config: Config = {
    port: integer('PORT', 3000, 1),
    logLevel: isLogLevel(logLevelRaw) ? logLevelRaw : 'info',
    maxBodyBytes: integer('HTTP_MAX_BODY_BYTES', 128 * 1024, 1),
    channels: { whatsapp, telegram },
    ai: {
      provider,
      systemPrompt: optional('AI_SYSTEM_PROMPT', DEFAULT_SYSTEM_PROMPT),
      fallbackText: optional('AI_FALLBACK_TEXT', DEFAULT_FALLBACK_TEXT),
      unsupportedText: optional('AI_UNSUPPORTED_TEXT', DEFAULT_UNSUPPORTED_TEXT),
      timeoutMs: integer('AI_TIMEOUT_MS', 20_000, 1),
      ai21,
      ollama,
    },
    send: {
      timeoutMs: integer('SEND_TIMEOUT_MS', 10_000, 1),
      retries: integer('SEND_RETRIES', 2, 0),
    },
    dedup: {
      // Meta retries for up to 36 hours, but a duplicate that matters arrives
      // within seconds. Six hours is generous and keeps the map small.
      ttlMs: integer('DEDUP_TTL_MS', 6 * 60 * 60 * 1000, 1),
      maxEntries: integer('DEDUP_MAX_ENTRIES', 10_000, 1),
    },
    queue: {
      concurrency: integer('QUEUE_CONCURRENCY', 4, 1),
      maxPending: integer('QUEUE_MAX_PENDING', 500, 1),
    },
    shutdown: {
      graceMs: integer('SHUTDOWN_GRACE_MS', 0, 0),
      drainMs: integer('SHUTDOWN_DRAIN_MS', 10_000, 1),
    },
  }

  if (problems.length > 0) throw new ConfigError(problems)
  return config
}
