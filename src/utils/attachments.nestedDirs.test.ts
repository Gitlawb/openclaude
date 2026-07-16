import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'path'
import { getDirectoriesToProcess } from './attachments.js'

// Build every fixture with node:path so drive letters and separators match what
// the implementation's own resolve()/dirname() produce on Windows as well.
const WORK = resolve('/work')
const CWD = join(WORK, 'myapp')
const PREFIXED_SIBLING = join(WORK, 'myapp-backend')
const PLAIN_SIBLING = join(WORK, 'backend')

describe('getDirectoriesToProcess', () => {
  test('does not treat a name-prefixed sibling as nested under the CWD', () => {
    // `/work/myapp-backend` is a sibling of the CWD, not a directory "between
    // CWD and targetPath". A string-prefix test accepted it because the name
    // starts with "myapp", so its CLAUDE.md was loaded as Project memory —
    // e.g. `cd /work/myapp && claude --add-dir ../myapp-backend`.
    const { nestedDirs } = getDirectoriesToProcess(
      join(PREFIXED_SIBLING, 'src', 'a.ts'),
      CWD,
    )
    expect(nestedDirs).toEqual([])
  })

  test('treats sibling directories the same regardless of their name', () => {
    // The only difference here is spelling: `backend` shares no prefix with the
    // CWD's name while `myapp-backend` does. Both are siblings, so both must
    // behave identically.
    const prefixed = getDirectoriesToProcess(
      join(PREFIXED_SIBLING, 'src', 'a.ts'),
      CWD,
    ).nestedDirs
    const unprefixed = getDirectoriesToProcess(
      join(PLAIN_SIBLING, 'src', 'a.ts'),
      CWD,
    ).nestedDirs
    expect(prefixed).toEqual(unprefixed)
  })

  test('still collects directories genuinely nested under the CWD', () => {
    const { nestedDirs } = getDirectoriesToProcess(
      join(CWD, 'src', 'deep', 'a.ts'),
      CWD,
    )
    expect(nestedDirs).toEqual([join(CWD, 'src'), join(CWD, 'src', 'deep')])
  })

  test('reports directories from the root down to the CWD', () => {
    const { cwdLevelDirs } = getDirectoriesToProcess(
      join(CWD, 'src', 'a.ts'),
      CWD,
    )
    expect(cwdLevelDirs).toEqual([WORK, CWD])
  })
})
