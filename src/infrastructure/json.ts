/**
 * Narrowing helpers for payloads that arrive as `unknown`.
 *
 * Both channel parsers walk third-party JSON, and neither can assume the shape
 * it documents. Optional chaining alone types the result as `any` and hands
 * the compiler back nothing, which is most of the point of the rewrite. These
 * return null instead, so every missing field has to be handled.
 *
 * A schema library would do this too. Four functions and no dependency is the
 * better trade for two payload shapes.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Numeric ids arrive as numbers on Telegram and as strings on WhatsApp. */
export function asIdString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return asString(value)
}
