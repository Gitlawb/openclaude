import { describe, expect, test } from 'bun:test'
import { getDirectoriesToProcess } from './attachments.js'

describe('getDirectoriesToProcess', () => {
  test('does not treat a name-prefixed sibling as nested under the CWD', () => {
    // `/work/myapp-backend` is a sibling of the CWD, not a directory "between
    // CWD and targetPath". A string-prefix test accepted it because the name
    // starts with "myapp", so its CLAUDE.md was loaded as Project memory —
    // e.g. `cd /work/myapp && claude --add-dir ../myapp-backend`.
    const { nestedDirs } = getDirectoriesToProcess(
      '/work/myapp-backend/src/a.ts',
      '/work/myapp',
    )
    expect(nestedDirs).toEqual([])
  })

  test('treats sibling directories the same regardless of their name', () => {
    // The only difference here is spelling: `backend` shares no prefix with the
    // CWD's name while `myapp-backend` does. Both are siblings, so both must
    // behave identically.
    const prefixed = getDirectoriesToProcess(
      '/work/myapp-backend/src/a.ts',
      '/work/myapp',
    ).nestedDirs
    const unprefixed = getDirectoriesToProcess(
      '/work/backend/src/a.ts',
      '/work/myapp',
    ).nestedDirs
    expect(prefixed).toEqual(unprefixed)
  })

  test('still collects directories genuinely nested under the CWD', () => {
    const { nestedDirs } = getDirectoriesToProcess(
      '/work/myapp/src/deep/a.ts',
      '/work/myapp',
    )
    expect(nestedDirs).toEqual(['/work/myapp/src', '/work/myapp/src/deep'])
  })

  test('reports directories from the CWD down to the target', () => {
    const { cwdLevelDirs } = getDirectoriesToProcess(
      '/work/myapp/src/a.ts',
      '/work/myapp',
    )
    expect(cwdLevelDirs).toEqual(['/work', '/work/myapp'])
  })
})
