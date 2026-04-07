import { afterEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'node:path'

function installCommonMocks(options: {
  cwd: string
  existingFiles: string[]
  isWorkspaceDirEmpty?: boolean
}) {
  const existingFiles = new Set(options.existingFiles)

  mock.module('./utils/cwd.js', () => ({
    getCwd: () => options.cwd,
  }))

  mock.module('./utils/file.js', () => ({
    isDirEmpty: () => options.isWorkspaceDirEmpty ?? false,
  }))

  // Mock the whole fsOperations module but re-export all named exports so that
  // other test files in the same Bun process don't get "Export not found" errors
  // for safeResolvePath / isDuplicatePath / etc.
  // We keep a module-level activeFs variable inside the mock closure so that
  // setFsImplementation/setOriginalFsImplementation still work across calls.
  let _activeFs = {
    existsSync: (filePath: string) => existingFiles.has(filePath),
  }
  mock.module('./utils/fsOperations.js', () => {
    // Stub only what projectOnboardingSteps actually calls:
    //   getFsImplementation().existsSync
    // All other exports are stubs that throw if called, so callers that truly
    // need them will fail loudly rather than silently returning undefined.
    const notImpl =
      (name: string) =>
      (..._args: unknown[]) => {
        throw new Error(`fsOperations.${name} not implemented in test stub`)
      }
    return {
      getFsImplementation: () => _activeFs,
      setFsImplementation: (impl: typeof _activeFs) => {
        _activeFs = impl
      },
      setOriginalFsImplementation: () => {
        _activeFs = {
          existsSync: (filePath: string) => existingFiles.has(filePath),
        }
      },
      // Re-export stubs for all other named exports so the module shape is
      // preserved and other test files importing them don't get SyntaxError.
      safeResolvePath: notImpl('safeResolvePath'),
      isDuplicatePath: notImpl('isDuplicatePath'),
      resolveDeepestExistingAncestorSync: notImpl(
        'resolveDeepestExistingAncestorSync',
      ),
      getPathsForPermissionCheck: notImpl('getPathsForPermissionCheck'),
      NodeFsOperations: {},
      readFileRange: notImpl('readFileRange'),
      tailFile: notImpl('tailFile'),
      readLinesReverse: notImpl('readLinesReverse'),
    }
  })
}

async function importFreshProjectOnboardingState(options: {
  cwd: string
  existingFiles: string[]
  isWorkspaceDirEmpty?: boolean
}) {
  mock.restore()
  installCommonMocks(options)
  return import(`./projectOnboardingSteps.ts?ts=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  mock.restore()
})

describe('project onboarding completion', () => {
  test('is incomplete when neither AGENTS.md nor CLAUDE.md exists', async () => {
    const cwd = '/repo'
    const { getSteps, isProjectOnboardingComplete } =
      await importFreshProjectOnboardingState({
        cwd,
        existingFiles: [],
      })

    expect(isProjectOnboardingComplete()).toBe(false)
    expect(getSteps()[1]?.text).toContain('AGENTS.md')
  })

  test('is complete when only CLAUDE.md exists', async () => {
    const cwd = '/repo'
    const { isProjectOnboardingComplete } =
      await importFreshProjectOnboardingState({
        cwd,
        existingFiles: [join(cwd, 'CLAUDE.md')],
      })

    expect(isProjectOnboardingComplete()).toBe(true)
  })

  test('is complete when only AGENTS.md exists', async () => {
    const cwd = '/repo'
    const { isProjectOnboardingComplete } =
      await importFreshProjectOnboardingState({
        cwd,
        existingFiles: [join(cwd, 'AGENTS.md')],
      })

    expect(isProjectOnboardingComplete()).toBe(true)
  })
})
