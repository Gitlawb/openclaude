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

  mock.module('./utils/fsOperations.js', () => ({
    getFsImplementation: () => ({
      existsSync: (filePath: string) => existingFiles.has(filePath),
    }),
  }))
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
