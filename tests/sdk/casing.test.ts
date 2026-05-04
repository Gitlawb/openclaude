import { describe, test, expect } from 'bun:test'
import {
  snakeToCamel,
  camelToSnake,
  mapKeysToCamel,
  mapKeysToSnake,
} from '../../src/entrypoints/sdk/casing.js'

describe('snakeToCamel', () => {
  test('converts snake_case to camelCase', () => {
    expect(snakeToCamel('session_id')).toBe('sessionId')
    expect(snakeToCamel('last_modified')).toBe('lastModified')
    expect(snakeToCamel('parent_tool_use_id')).toBe('parentToolUseId')
  })

  test('leaves already-camelCase unchanged', () => {
    expect(snakeToCamel('sessionId')).toBe('sessionId')
    expect(snakeToCamel('cwd')).toBe('cwd')
  })

  test('handles empty string', () => {
    expect(snakeToCamel('')).toBe('')
  })

  test('handles consecutive underscores correctly', () => {
    // __proto__ should become Proto (both underscores removed before letter)
    expect(snakeToCamel('__proto__')).toBe('Proto')
    expect(snakeToCamel('__typename')).toBe('Typename')
    expect(snakeToCamel('a__b_c')).toBe('aB_c')
  })

  test('preserves trailing underscores', () => {
    expect(snakeToCamel('test_')).toBe('test_')
    expect(snakeToCamel('test__')).toBe('test__')
  })
})

describe('camelToSnake', () => {
  test('converts camelCase to snake_case', () => {
    expect(camelToSnake('sessionId')).toBe('session_id')
    expect(camelToSnake('lastModified')).toBe('last_modified')
  })

  test('leaves already-snake_case unchanged', () => {
    expect(camelToSnake('session_id')).toBe('session_id')
  })
})

describe('mapKeysToCamel', () => {
  test('converts top-level keys', () => {
    const input = { session_id: 'abc', last_modified: 123 }
    const result = mapKeysToCamel(input)
    expect(result).toEqual({ sessionId: 'abc', lastModified: 123 })
  })

  test('converts nested object keys', () => {
    const input = { outer_key: { inner_key: 'value' } }
    const result = mapKeysToCamel(input)
    expect(result).toEqual({ outerKey: { innerKey: 'value' } })
  })

  test('converts arrays of objects', () => {
    const input = [{ item_name: 'a' }, { item_name: 'b' }]
    const result = mapKeysToCamel(input)
    expect(result).toEqual([{ itemName: 'a' }, { itemName: 'b' }])
  })

  test('returns null/undefined as-is', () => {
    expect(mapKeysToCamel(null)).toBeNull()
    expect(mapKeysToCamel(undefined)).toBeUndefined()
  })

  test('returns primitives as-is', () => {
    expect(mapKeysToCamel('hello')).toBe('hello')
    expect(mapKeysToCamel(42)).toBe(42)
  })
})

describe('mapKeysToSnake', () => {
  test('converts top-level keys', () => {
    const input = { sessionId: 'abc', lastModified: 123 }
    const result = mapKeysToSnake(input)
    expect(result).toEqual({ session_id: 'abc', last_modified: 123 })
  })

  test('round-trips with mapKeysToCamel', () => {
    const original = { session_id: 'abc', last_modified: 123 }
    const camel = mapKeysToCamel(original)
    const back = mapKeysToSnake(camel)
    expect(back).toEqual(original)
  })
})
