import { expect, test } from 'bun:test'

import { applySedSubstitution, type SedEditInfo } from './sedEditParser.js'

function sedInfo(pattern: string, replacement: string, extendedRegex = false): SedEditInfo {
  return {
    filePath: 'example.txt',
    pattern,
    replacement,
    flags: 'g',
    extendedRegex,
  }
}

test('BRE mode keeps unescaped plus literal', () => {
  const result = applySedSubstitution(
    'a+b and aaab',
    sedInfo('a+b', 'literal-plus'),
  )

  expect(result).toBe('literal-plus and aaab')
})

test('BRE mode treats escaped plus as one-or-more', () => {
  const result = applySedSubstitution(
    'abbb and a+b',
    sedInfo('ab\\+', 'one-or-more'),
  )

  expect(result).toBe('one-or-more and a+b')
})

test('BRE mode preserves escaped backslashes', () => {
  const result = applySedSubstitution(
    String.raw`foo\bar foo/bar`,
    sedInfo(String.raw`foo\\bar`, 'backslash-match'),
  )

  expect(result).toBe('backslash-match foo/bar')
})
