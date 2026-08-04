import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { hmacSha256Hex, safeEqual } from '../src/infrastructure/signature.ts'

describe('safeEqual', () => {
  it('accepts identical strings', () => {
    assert.equal(safeEqual('abc123', 'abc123'), true)
  })

  it('rejects strings that differ', () => {
    assert.equal(safeEqual('abc123', 'abc124'), false)
  })

  it('rejects strings of different length without throwing', () => {
    // timingSafeEqual itself throws on a length mismatch, which would turn a
    // wrong signature into a 500 instead of a 403.
    assert.equal(safeEqual('short', 'much longer value'), false)
    assert.equal(safeEqual('', 'x'), false)
  })

  it('accepts two empty strings', () => {
    assert.equal(safeEqual('', ''), true)
  })

  it('compares bytes, not code points', () => {
    // 'é' is two bytes in UTF-8, so a naive length check on characters would
    // disagree with the buffer comparison.
    assert.equal(safeEqual('é', 'é'), true)
    assert.equal(safeEqual('é', 'e'), false)
  })
})

describe('hmacSha256Hex', () => {
  it('matches a signature produced independently', () => {
    const payload = Buffer.from('{"hello":"world"}', 'utf8')
    const expected = createHmac('sha256', 'secret').update(payload).digest('hex')

    assert.equal(hmacSha256Hex('secret', payload), expected)
  })

  it('changes completely when one byte of the payload changes', () => {
    const a = hmacSha256Hex('secret', Buffer.from('{"n":1}', 'utf8'))
    const b = hmacSha256Hex('secret', Buffer.from('{"n":2}', 'utf8'))

    assert.notEqual(a, b)
  })

  it('changes when the secret changes', () => {
    const payload = Buffer.from('same', 'utf8')

    assert.notEqual(hmacSha256Hex('one', payload), hmacSha256Hex('two', payload))
  })

  it('signs raw bytes, so whitespace in the JSON matters', () => {
    // This is why the body is read as a Buffer and never re-serialised: an
    // equivalent JSON document with different spacing signs differently.
    const compact = hmacSha256Hex('secret', Buffer.from('{"a":1}', 'utf8'))
    const spaced = hmacSha256Hex('secret', Buffer.from('{ "a": 1 }', 'utf8'))

    assert.notEqual(compact, spaced)
  })
})
