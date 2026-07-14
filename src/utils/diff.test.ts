import { describe, expect, mock, test } from 'bun:test'

// Analytics is a leaf side effect of countLinesChanged; stub it so the test
// only exercises the counting.
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

import { getTotalLinesAdded } from '../bootstrap/state.js'
import { countLinesChanged } from './diff.js'

// countLinesChanged is void; it feeds the running total via addToTotalLinesChanged.
// Measure the delta it contributes for a given call.
function addedLinesFor(newFileContent: string): number {
  const before = getTotalLinesAdded()
  countLinesChanged([], newFileContent)
  return getTotalLinesAdded() - before
}

describe('countLinesChanged — new file additions', () => {
  test('a newline-terminated file counts one addition per content line, like git', () => {
    // "a\nb\n" is a 2-line file; git reports 2 additions, not 3. The trailing
    // newline must not be counted as an extra empty line.
    expect(addedLinesFor('a\nb\n')).toBe(2)
    expect(addedLinesFor('line1\nline2\nline3\n')).toBe(3)
    expect(addedLinesFor('only\n')).toBe(1)
  })

  test('a file without a trailing newline counts each line', () => {
    expect(addedLinesFor('a\nb')).toBe(2)
    expect(addedLinesFor('single')).toBe(1)
  })

  test('CRLF line endings are counted the same as LF', () => {
    expect(addedLinesFor('a\r\nb\r\n')).toBe(2)
    expect(addedLinesFor('a\r\nb')).toBe(2)
  })
})
