/**
 * One JSON object per line on stdout, which is what a log collector expects
 * and what `docker logs` can still be read by eye.
 *
 * Message bodies never reach here. What users write to the bot and what the
 * model answers are private, so the call sites log ids and counts instead.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type LogFields = Record<string, unknown>

export type Logger = {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** Returns a logger that adds `fields` to every record it writes. */
  child(fields: LogFields): Logger
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value)
}

/**
 * Keeps the last four characters of an identifier and masks the rest, so a
 * phone number or a chat id can be correlated across records without the log
 * becoming a contact list.
 */
export function redact(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`
}

type Sink = (line: string) => void

export type LoggerOptions = {
  readonly level: LogLevel
  /** Defaults to stdout. Tests pass a collector. */
  readonly sink?: Sink
  /** Defaults to the wall clock. Tests pass a fixed one. */
  readonly now?: () => Date
}

export function createLogger(options: LoggerOptions): Logger {
  const sink: Sink = options.sink ?? ((line) => process.stdout.write(`${line}\n`))
  const now = options.now ?? (() => new Date())
  const threshold = LOG_LEVELS.indexOf(options.level)

  function build(base: LogFields): Logger {
    function write(level: LogLevel, message: string, fields?: LogFields): void {
      if (LOG_LEVELS.indexOf(level) < threshold) return
      sink(JSON.stringify({ time: now().toISOString(), level, message, ...base, ...fields }))
    }

    return {
      debug: (message, fields) => write('debug', message, fields),
      info: (message, fields) => write('info', message, fields),
      warn: (message, fields) => write('warn', message, fields),
      error: (message, fields) => write('error', message, fields),
      child: (fields) => build({ ...base, ...fields }),
    }
  }

  return build({})
}
