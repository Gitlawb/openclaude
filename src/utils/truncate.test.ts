import { describe, expect, test } from 'bun:test'
import { truncate, truncateToWidth, truncatePathMiddle } from './truncate.js'

describe('truncate utilities', () => {
  test('truncate returns empty string for undefined input', () => {
    expect(truncate(undefined, 10)).toBe('')
  })

  test('truncateToWidth returns empty string for undefined input', () => {
    expect(truncateToWidth(undefined, 5)).toBe('')
  })

  test('truncatePathMiddle returns empty string for undefined path', () => {
    expect(truncatePathMiddle(undefined, 20)).toBe('')
  })

  test('truncate respects single-line mode and display width together', () => {
    expect(truncate('abcdefghij\nrest', 5, true)).toBe('abcd\u2026')
  })

  test('truncateToWidth preserves CJK display width boundaries', () => {
    expect(truncateToWidth('\u4f60\u597d\u4e16\u754c', 5)).toBe(
      '\u4f60\u597d\u2026',
    )
  })
})
