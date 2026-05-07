import { describe, expect, test } from 'bun:test'
import { sortKeysDeep, stableStringify } from './stableStringify'

/**
 * Contract: `stableStringify(input)` must equal `JSON.stringify(input)`
 * for every value where the latter is well-defined, except that object
 * keys are emitted in lexicographic order at every depth. These tests
 * focus on the native pre-processing semantics — `toJSON(key)` and
 * primitive-wrapper unboxing — that the deep-sort path must preserve.
 */

describe('stableStringify — toJSON semantics', () => {
  test('Date at top level → ISO string', () => {
    const d = new Date('2024-01-02T03:04:05.678Z')
    expect(stableStringify(d)).toBe(JSON.stringify(d))
  })

  test('Date nested in object → ISO string + sorted keys', () => {
    const d = new Date('2024-01-02T03:04:05.678Z')
    const input = { z: 1, when: d, a: 'x' }
    expect(stableStringify(input)).toBe(
      `{"a":"x","␟when␟":"PLACEHOLDER","z":1}`
        .replace('␟when␟', 'when')
        .replace('"PLACEHOLDER"', JSON.stringify(d.toISOString())),
    )
  })

  test('Date inside an array → each element converted', () => {
    const a = new Date('2024-01-02T03:04:05.678Z')
    const b = new Date('2025-06-07T08:09:10.111Z')
    const input = [a, b]
    expect(stableStringify(input)).toBe(JSON.stringify(input))
  })

  test('URL value serializes via URL.prototype.toJSON', () => {
    const u = new URL('https://example.com/path?q=1')
    expect(stableStringify(u)).toBe(JSON.stringify(u))
    expect(stableStringify({ url: u })).toBe(JSON.stringify({ url: u }))
  })

  test('custom class with toJSON returning a plain object → keys sorted', () => {
    class Thing {
      toJSON() {
        return { z: 1, a: 2, m: 3 }
      }
    }
    const out = stableStringify(new Thing())
    expect(out).toBe('{"a":2,"m":3,"z":1}')
  })

  test('toJSON(key) receives the property name for object values', () => {
    const seen: string[] = []
    class Trace {
      toJSON(k: string) {
        seen.push(k)
        return k
      }
    }
    const t = new Trace()
    stableStringify({ alpha: t, beta: t })
    // Object keys are sorted, so toJSON is invoked alpha-first.
    expect(seen).toEqual(['alpha', 'beta'])
  })

  test('toJSON(key) receives the array index as a string for array elements', () => {
    const seen: string[] = []
    class Trace {
      toJSON(k: string) {
        seen.push(k)
        return k
      }
    }
    const t = new Trace()
    stableStringify([t, t, t])
    expect(seen).toEqual(['0', '1', '2'])
  })

  test('toJSON(key) receives empty string at top level', () => {
    let captured: string | undefined
    class Trace {
      toJSON(k: string) {
        captured = k
        return 'ok'
      }
    }
    stableStringify(new Trace())
    expect(captured).toBe('')
  })

  test('toJSON returning undefined drops the property (matches native)', () => {
    class Hidden {
      toJSON() {
        return undefined
      }
    }
    const input = { a: 1, gone: new Hidden(), b: 2 }
    expect(stableStringify(input)).toBe(JSON.stringify(input))
    expect(stableStringify(input)).toBe('{"a":1,"b":2}')
  })

  test('nested mix: object with a Date field and a regular field → keys sorted, Date as ISO', () => {
    const d = new Date('2024-01-02T03:04:05.678Z')
    const input = { z: { when: d, a: 1 }, a: 'first' }
    expect(stableStringify(input)).toBe(
      `{"a":"first","z":{"a":1,"when":${JSON.stringify(d.toISOString())}}}`,
    )
  })
})

describe('stableStringify — primitive wrapper unboxing', () => {
  test('new Number at top level → numeric primitive', () => {
    const n = new Number(42)
    expect(stableStringify(n)).toBe(JSON.stringify(n))
    expect(stableStringify(n)).toBe('42')
  })

  test('new String at top level → string primitive', () => {
    const s = new String('hello')
    expect(stableStringify(s)).toBe(JSON.stringify(s))
    expect(stableStringify(s)).toBe('"hello"')
  })

  test('new Boolean at top level → boolean primitive', () => {
    const b = new Boolean(true)
    expect(stableStringify(b)).toBe(JSON.stringify(b))
    expect(stableStringify(b)).toBe('true')
  })

  test('new Boolean(false) at top level → false', () => {
    const b = new Boolean(false)
    expect(stableStringify(b)).toBe(JSON.stringify(b))
    expect(stableStringify(b)).toBe('false')
  })

  test('boxed wrappers as object values → primitives + sorted keys', () => {
    const input = {
      z: new Number(1),
      a: new String('x'),
      m: new Boolean(false),
    }
    expect(stableStringify(input)).toBe('{"a":"x","m":false,"z":1}')
    // Native form: same primitive shape (without sort guarantee).
    expect(JSON.parse(stableStringify(input))).toEqual(JSON.parse(JSON.stringify(input)))
  })
})

describe('stableStringify — cycles vs DAGs', () => {
  test('top-level cycle throws TypeError (regression guard)', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(() => stableStringify(obj)).toThrow(TypeError)
  })

  test('deep cycle throws TypeError', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b' }
    a.next = b
    b.back = a
    expect(() => stableStringify(a)).toThrow(TypeError)
  })

  test('toJSON returning an ancestor still triggers the cycle check', () => {
    type Node = { name: string; child?: { toJSON(): Node } }
    const parent: Node = { name: 'parent' }
    parent.child = {
      toJSON() {
        return parent
      },
    }
    expect(() => stableStringify(parent)).toThrow(TypeError)
  })

  test('DAG (same object referenced twice via different keys) does NOT throw', () => {
    const shared = { v: 1 }
    const input = { left: shared, right: shared }
    expect(() => stableStringify(input)).not.toThrow()
    expect(stableStringify(input)).toBe('{"left":{"v":1},"right":{"v":1}}')
  })

  test('DAG of arrays does NOT throw', () => {
    const shared = [1, 2, 3]
    const input = { a: shared, b: shared }
    expect(() => stableStringify(input)).not.toThrow()
    expect(stableStringify(input)).toBe('{"a":[1,2,3],"b":[1,2,3]}')
  })
})

describe('sortKeysDeep — same toJSON/unbox semantics', () => {
  test('returns the post-toJSON, post-unbox sorted shape', () => {
    const d = new Date('2024-01-02T03:04:05.678Z')
    const out = sortKeysDeep({ z: 1, a: new Number(7), when: d }) as Record<
      string,
      unknown
    >
    expect(out).toEqual({ a: 7, when: d.toISOString(), z: 1 })
    // Key order in the returned object is lexicographic.
    expect(Object.keys(out)).toEqual(['a', 'when', 'z'])
  })
})
