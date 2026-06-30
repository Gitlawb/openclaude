import { expect, test } from 'bun:test'

import { relativizeContentLine } from '../../utils/path.js'

// relativizeContentLine strips the known absolute search root from a ripgrep
// content row, so the relative path plus the original ripgrep delimiter and
// content survive verbatim. Passing the root explicitly keeps these assertions
// deterministic across Windows, macOS, and Linux.

test('relativizes a Windows match row without splitting on the drive colon', () => {
  expect(
    relativizeContentLine(
      'C:\\Users\\proj\\src\\file.ts:42:const x = 1',
      'C:\\Users\\proj',
    ),
  ).toBe('src\\file.ts:42:const x = 1')
})

test('relativizes a POSIX match row', () => {
  expect(
    relativizeContentLine('/home/u/p/src/file.ts:42:const x = 1', '/home/u/p'),
  ).toBe('src/file.ts:42:const x = 1')
})

test('relativizes the path:content form (no line number)', () => {
  expect(
    relativizeContentLine('C:\\Users\\proj\\src\\a.ts:const y = 2', 'C:\\Users\\proj'),
  ).toBe('src\\a.ts:const y = 2')
})

test('relativizes a Windows context row (dash-separated -A/-B/-C)', () => {
  expect(
    relativizeContentLine(
      'C:\\Users\\proj\\src\\file.ts-41-const before',
      'C:\\Users\\proj',
    ),
  ).toBe('src\\file.ts-41-const before')
})

test('relativizes a context row with line numbers disabled (path-content)', () => {
  // With show_line_numbers: false, rg omits the `-<n>-` and emits `path-content`.
  // Prefix stripping still works where delimiter parsing could not.
  expect(
    relativizeContentLine(
      'C:\\Users\\proj\\src\\file.ts-const before',
      'C:\\Users\\proj',
    ),
  ).toBe('src\\file.ts-const before')
})

test('relativizes when the cwd itself contains a date-like -<digits>- segment', () => {
  // Regression: a delimiter heuristic would split this row at `-2024-`. Prefix
  // stripping against the known root handles it correctly.
  expect(
    relativizeContentLine(
      'C:\\Users\\proj-2024-01-15\\src\\file.ts-41-context',
      'C:\\Users\\proj-2024-01-15',
    ),
  ).toBe('src\\file.ts-41-context')
})

test('keeps a path outside the root absolute', () => {
  expect(relativizeContentLine('D:\\other\\file.ts:1:x', 'C:\\Users\\proj')).toBe(
    'D:\\other\\file.ts:1:x',
  )
})

test('does not treat a sibling dir with a shared prefix as under the root', () => {
  // `C:\proj2` is not under `C:\proj`; the required trailing separator guards it.
  expect(relativizeContentLine('C:\\proj2\\file.ts:1:x', 'C:\\proj')).toBe(
    'C:\\proj2\\file.ts:1:x',
  )
})

test('handles a drive-root cwd that already ends with a separator', () => {
  expect(relativizeContentLine('C:\\file.ts:1:x', 'C:\\')).toBe('file.ts:1:x')
})

test('relativizes a Windows root spelled with different casing', () => {
  // getCwd() and ripgrep can spell the same root with different casing; Windows
  // paths are case-insensitive, so this must still strip rather than leak.
  expect(
    relativizeContentLine('C:\\Users\\proj\\src\\file.ts:1:x', 'C:\\USERS\\PROJ'),
  ).toBe('src\\file.ts:1:x')
})

test('relativizes a forward-slash root against a backslash line', () => {
  expect(
    relativizeContentLine('C:\\Users\\proj\\src\\file.ts:1:x', 'C:/Users/proj'),
  ).toBe('src\\file.ts:1:x')
})

test('returns an unrelated line unchanged', () => {
  expect(relativizeContentLine('just-some-text', '/home/u/p')).toBe('just-some-text')
})

test('defaults root to the cwd when not supplied', () => {
  // A line that is not under the real cwd is returned untouched, exercising the
  // default-argument path without depending on the cwd's exact value.
  expect(relativizeContentLine('Z:\\nowhere\\x.ts:1:y')).toBe('Z:\\nowhere\\x.ts:1:y')
})
