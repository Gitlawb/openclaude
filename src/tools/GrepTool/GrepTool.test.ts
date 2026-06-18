import { expect, test } from 'bun:test'
import path from 'node:path'

import { relativizeContentLine } from '../../utils/path.js'

// Deterministic relativizers that don't depend on the host OS or real cwd,
// so the same assertions hold on Windows, macOS, and Linux. They mirror
// toRelativePath's "keep absolute when outside cwd" behaviour.
function makeRelativize(
  impl: typeof path.win32 | typeof path.posix,
  cwd: string,
): (p: string) => string {
  return (absolutePath: string) => {
    const rel = impl.relative(cwd, absolutePath)
    return rel.startsWith('..') ? absolutePath : rel
  }
}

test('relativizes a Windows drive-letter path without splitting on the drive colon', () => {
  const relativize = makeRelativize(path.win32, 'C:\\Users\\proj')
  // The leading `C:` must not be mistaken for the path/content separator.
  expect(
    relativizeContentLine(
      'C:\\Users\\proj\\src\\file.ts:42:const x = 1',
      relativize,
    ),
  ).toBe('src\\file.ts:42:const x = 1')
})

test('relativizes a POSIX path using the first colon as the boundary', () => {
  const relativize = makeRelativize(path.posix, '/home/u/p')
  expect(
    relativizeContentLine('/home/u/p/src/file.ts:42:const x = 1', relativize),
  ).toBe('src/file.ts:42:const x = 1')
})

test('handles the path:content form (no line number)', () => {
  const winRelativize = makeRelativize(path.win32, 'C:\\Users\\proj')
  expect(
    relativizeContentLine('C:\\Users\\proj\\src\\a.ts:const y = 2', winRelativize),
  ).toBe('src\\a.ts:const y = 2')

  const posixRelativize = makeRelativize(path.posix, '/home/u/p')
  expect(
    relativizeContentLine('/home/u/p/src/a.ts:const y = 2', posixRelativize),
  ).toBe('src/a.ts:const y = 2')
})

test('relativizes a Windows context row (dash-separated `-A`/`-B`/`-C`)', () => {
  // Context rows use `-` separators, so there is no boundary colon after the
  // drive. The `C:` drive colon must still be skipped and the `-<n>-` boundary
  // used instead of leaving the absolute path in place.
  const relativize = makeRelativize(path.win32, 'C:\\Users\\proj')
  expect(
    relativizeContentLine(
      'C:\\Users\\proj\\src\\file.ts-41-const before',
      relativize,
    ),
  ).toBe('src\\file.ts-41-const before')
})

test('relativizes a POSIX context row (dash-separated)', () => {
  const relativize = makeRelativize(path.posix, '/home/u/p')
  expect(
    relativizeContentLine('/home/u/p/src/file.ts-41-const before', relativize),
  ).toBe('src/file.ts-41-const before')
})

test('uses the `:<n>:` match boundary even when the filename has a `-<n>-` run', () => {
  // A date-like `-2024-` inside the filename must not be mistaken for the
  // context boundary on a match row; the unambiguous `:<n>:` wins.
  const relativize = makeRelativize(path.win32, 'C:\\Users\\proj')
  expect(
    relativizeContentLine(
      'C:\\Users\\proj\\report-2024-01-15.ts:7:hit',
      relativize,
    ),
  ).toBe('report-2024-01-15.ts:7:hit')
})

test('returns a line with no colon unchanged', () => {
  const relativize = makeRelativize(path.posix, '/home/u/p')
  expect(relativizeContentLine('just-some-text-no-colon', relativize)).toBe(
    'just-some-text-no-colon',
  )
})

test('returns a bare Windows drive path (only the drive colon) unchanged', () => {
  // `C:` has its sole colon at index 1, which is inside the skipped drive
  // prefix, so there is no boundary colon and the line passes through.
  const relativize = makeRelativize(path.win32, 'C:\\Users\\proj')
  expect(relativizeContentLine('C:', relativize)).toBe('C:')
})

test('defaults to toRelativePath when no relativizer is supplied', () => {
  // Without a path/content boundary colon the line is returned untouched,
  // exercising the default-argument path without depending on real cwd.
  expect(relativizeContentLine('no-colon-here')).toBe('no-colon-here')
})
