import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../test/sharedMutationLock.js'

// Analytics is a leaf side effect of countLinesChanged; stub it so the test
// only exercises the counting. The stub is registered in beforeAll (NOT at
// module load) and torn down in afterAll so the shared bun:test process loads
// the REAL analytics module for every other test file at startup.
//
// bun evaluates all test files' module-level imports up front and caches the
// resolved modules. A module-level mock.module() here would leak the
// incomplete analytics stub into the ~245 importers of
// src/services/analytics/index.js and break unrelated files in the smoke suite
// depending on run order — the classic flaky "smoke" defect. Registering the
// stub only for the lifetime of this suite (beforeAll → afterAll) keeps the
// subject's import of the stubbed module isolated to this file.
// Bun's bun:test types declare mock.module() as returning void | Promise<void>
// and do not model the returned MockModule, so we capture the handle with an
// explicit cast. The returned object exposes unmock(), which is the documented
// teardown for a module mock (there is no mock.restoreModule()).
type MockModuleHandle = { unmock: () => void | Promise<void> }
let analyticsModuleMock: MockModuleHandle | undefined
let countLinesChanged: Awaited<typeof import('./diff.js')>['countLinesChanged']
let getTotalLinesAdded: Awaited<
  typeof import('../bootstrap/state.js')
>['getTotalLinesAdded']

beforeAll(async () => {
  await acquireSharedMutationLock('utils/diff.test.ts')
  analyticsModuleMock = mock.module('src/services/analytics/index.js', () => ({
    logEvent: () => {},
  })) as unknown as MockModuleHandle
  ;({ countLinesChanged } = await import('./diff.js'))
  ;({ getTotalLinesAdded } = await import('../bootstrap/state.js'))
})

// countLinesChanged is void; it feeds the running total via addToTotalLinesChanged.
// Measure the delta it contributes for a given call.
function addedLinesFor(newFileContent: string): number {
  const before = getTotalLinesAdded()
  countLinesChanged([], newFileContent)
  return getTotalLinesAdded() - before
}

afterAll(() => {
  try {
    analyticsModuleMock?.unmock()
  } finally {
    releaseSharedMutationLock()
  }
})

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
