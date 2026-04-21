import { describe, expect, test } from 'bun:test'
import {
  fnv1a32,
  sortKeysDeep,
  stableStringify,
} from './stableStringify.js'

// These tests pin byte-level stability of serialization helpers. The
// invariant that matters for implicit prefix caching in OpenAI / Kimi /
// DeepSeek / Codex — and for Anthropic cache_control breakpoints — is:
// semantically-equal inputs must produce byte-identical output across
// invocations and across key-order permutations.

describe('stableStringify', () => {
  test('two invocations with the same object produce identical strings', () => {
    const a = stableStringify({ b: 1, a: 2 })
    const b = stableStringify({ b: 1, a: 2 })
    expect(a).toBe(b)
  })

  test('key order at the top level does not affect output', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  test('key order at nested depths does not affect output', () => {
    const x = { outer: { z: 1, a: 2, m: { b: 3, a: 4 } } }
    const y = { outer: { m: { a: 4, b: 3 }, a: 2, z: 1 } }
    expect(stableStringify(x)).toBe(stableStringify(y))
  })

  test('array element order IS preserved (semantic in API contracts)', () => {
    expect(stableStringify({ messages: ['a', 'b', 'c'] })).not.toBe(
      stableStringify({ messages: ['c', 'b', 'a'] }),
    )
  })

  test('arrays of objects have keys sorted inside each element', () => {
    const out = stableStringify({
      tools: [
        { name: 'Bash', description: 'run' },
        { description: 'read', name: 'Read' },
      ],
    })
    expect(out).toBe(
      '{"tools":[{"description":"run","name":"Bash"},{"description":"read","name":"Read"}]}',
    )
  })

  test('undefined values are omitted (matches JSON.stringify)', () => {
    const out = stableStringify({ a: undefined, b: 1 })
    expect(out).toBe('{"b":1}')
  })

  test('primitive and null pass through unchanged', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify('x')).toBe('"x"')
    expect(stableStringify(true)).toBe('true')
  })
})

describe('sortKeysDeep', () => {
  test('returns an object with sorted keys at every depth', () => {
    const sorted = sortKeysDeep({
      b: 1,
      a: { y: 2, x: { d: 3, c: 4 } },
    }) as Record<string, unknown>
    expect(Object.keys(sorted)).toEqual(['a', 'b'])
    expect(Object.keys(sorted.a as Record<string, unknown>)).toEqual([
      'x',
      'y',
    ])
  })

  test('arrays are preserved element-wise', () => {
    const sorted = sortKeysDeep([
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ]) as Array<Record<string, unknown>>
    expect(Object.keys(sorted[0]!)).toEqual(['a', 'b'])
    expect(Object.keys(sorted[1]!)).toEqual(['c', 'd'])
  })
})

describe('fnv1a32', () => {
  test('deterministic across calls', () => {
    expect(fnv1a32('hello world')).toBe(fnv1a32('hello world'))
  })

  test('different inputs produce different outputs', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'))
  })

  test('always emits 8 hex chars', () => {
    expect(fnv1a32('').length).toBe(8)
    expect(fnv1a32('a'.repeat(10_000))).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('prefix caching invariants — end-to-end', () => {
  // This is the real payload shape that an OpenAI-compatible body
  // takes on its way to the upstream provider. We exercise it via
  // stableStringify to verify that rebuilding the body with different
  // key insertion orders yields the same bytes.
  const bodyA = {
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hi' },
    ],
    tools: [{ name: 't', description: 'x' }],
    temperature: 0.7,
    top_p: 1,
  }
  const bodyB = {
    top_p: 1,
    temperature: 0.7,
    tools: [{ description: 'x', name: 't' }],
    messages: [
      { content: 'you are helpful', role: 'system' },
      { content: 'hi', role: 'user' },
    ],
    stream: true,
    model: 'gpt-4o-mini',
  }

  test('two spread-merged request bodies produce identical stable bytes', () => {
    expect(stableStringify(bodyA)).toBe(stableStringify(bodyB))
  })

  test('calling stableStringify twice yields identical bytes (idempotent)', () => {
    expect(stableStringify(bodyA)).toBe(stableStringify(bodyA))
  })
})
