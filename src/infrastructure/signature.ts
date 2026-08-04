import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Every secret comparison in the project goes through here.
 *
 * `===` on a secret leaks its prefix: the comparison stops at the first byte
 * that differs, so the time it takes is a measure of how much of the guess was
 * right. That is enough to recover a token one byte at a time.
 */

/** Constant-time string comparison. Differing lengths are false, not a throw. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch, and the length of a secret is
  // not itself a secret worth protecting here.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Lowercase hex HMAC-SHA256 of the exact bytes received. */
export function hmacSha256Hex(secret: string, payload: Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}
