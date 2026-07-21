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

  // Windows path comparison is case-insensitive, so `/work/MyApp` and
  // `/work/myapp` genuinely are the same directory there and treating them as
  // nested is correct. This behavior only differs on case-sensitive platforms.
  const caseSensitive = process.platform !== 'win32'
  const testIfCaseSensitive = caseSensitive ? test : test.skip

  testIfCaseSensitive('does not treat a case-variant sibling as nested', () => {
    // On a case-sensitive filesystem /work/MyApp and /work/myapp are two
    // unrelated projects. A case-folding containment check would merge them and
    // load the other project's CLAUDE.md/AGENTS.md as nested project memory.
    const caseVariant = join(WORK, 'MyApp')
    const { nestedDirs } = getDirectoriesToProcess(
      join(CWD, 'src', 'a.ts'),
      caseVariant,
    )
    expect(nestedDirs).not.toContain(CWD)
    expect(nestedDirs).not.toContain(join(CWD, 'src'))
  })

  test('collects a nested directory whose name begins with dots', () => {
    // `relative()` returns "..hello" here, which begins with ".." without being
    // an upward traversal — a string-prefix check would drop it.
    const dotted = join(CWD, '..hello')
    const { nestedDirs } = getDirectoriesToProcess(join(dotted, 'a.ts'), CWD)
    expect(nestedDirs).toContain(dotted)
  })

  test('reports directories from the root down to the CWD', () => {
    const { cwdLevelDirs } = getDirectoriesToProcess(
      join(CWD, 'src', 'a.ts'),
      CWD,
    )
    expect(cwdLevelDirs).toEqual([WORK, CWD])
  })
})
