import { expect, test, describe } from 'bun:test'
import { stringWidthJavaScript } from './stringWidth.js'

describe('stringWidthJavaScript', () => {
  test('handles ASCII', () => {
    expect(stringWidthJavaScript('abc')).toBe(3)
    expect(stringWidthJavaScript('  ')).toBe(2)
    expect(stringWidthJavaScript('')).toBe(0)
  })

  test('handles wide characters', () => {
    expect(stringWidthJavaScript('你好')).toBe(4)
    expect(stringWidthJavaScript('こんにちは')).toBe(10)
  })

  test('handles emoji', () => {
    expect(stringWidthJavaScript('😀')).toBe(2)
    expect(stringWidthJavaScript('👨‍👩‍👧‍👦')).toBe(2) // Family emoji (grapheme cluster)
    expect(stringWidthJavaScript('🇺🇸')).toBe(2) // Regional indicator
  })

  test('handles ANSI escape sequences', () => {
    expect(stringWidthJavaScript('\x1b[31mred\x1b[39m')).toBe(3)
    expect(stringWidthJavaScript('\x1b[1mbold\x1b[22m')).toBe(4)
  })

  test('handles symbols (Issue #1230)', () => {
    // These symbols should be width 1
    expect(stringWidthJavaScript('⚠')).toBe(1) // U+26A0
    expect(stringWidthJavaScript('✓')).toBe(1) // U+2713
    expect(stringWidthJavaScript('✖')).toBe(1) // U+2716
    expect(stringWidthJavaScript('ℹ')).toBe(1) // U+2139
    expect(stringWidthJavaScript('⚙')).toBe(1) // U+2699
    expect(stringWidthJavaScript('⚡')).toBe(2) // U+26A1 (Wide by default)
  })

  test('handles spinner symbols (PR Feedback)', () => {
    // These symbols were specifically requested in the PR feedback
    expect(stringWidthJavaScript('✳')).toBe(1) // U+2733
    expect(stringWidthJavaScript('✢')).toBe(1) // U+2722
    expect(stringWidthJavaScript('✶')).toBe(1) // U+2736
    expect(stringWidthJavaScript('✻')).toBe(1) // U+273B
    expect(stringWidthJavaScript('✽')).toBe(1) // U+273D
  })

  test('handles variation selectors', () => {
    // VS16 should make it width 2 if it's an emoji
    // Note: The behavior depends on whether the base character is in EMOJI_REGEX
    expect(stringWidthJavaScript('⚠️')).toBe(2) // ⚠ (U+26A0) + VS16 (U+FE0F)
  })

  test('handles mixed content', () => {
    expect(stringWidthJavaScript('Error ⚠')).toBe(7)
    expect(stringWidthJavaScript('Done ✓')).toBe(6)
  })
})
