import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getSteps,
  isProjectOnboardingComplete,
} from './projectOnboardingSteps.js'
import { runWithCwdOverride } from './utils/cwd.js'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('project onboarding completion', () => {
  test('is incomplete when neither AGENTS.md nor NNC.md exists', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-onboarding-'))

    await runWithCwdOverride(tempDir, async () => {
      expect(isProjectOnboardingComplete()).toBe(false)
      expect(getSteps()[1]?.text).toContain('/init')
      expect(getSteps()[1]?.text).toContain('AGENTS.md')
      expect(getSteps()[1]?.text).toContain('NNC.md')
    })
  })

  test('is complete when only NNC.md exists', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-onboarding-'))
    await writeFile(join(tempDir, 'NNC.md'), '# NNC.md\n')

    await runWithCwdOverride(tempDir, async () => {
      expect(isProjectOnboardingComplete()).toBe(true)
    })
  })

  test('is complete when only AGENTS.md exists', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-onboarding-'))
    await writeFile(join(tempDir, 'AGENTS.md'), '# AGENTS.md\n')

    await runWithCwdOverride(tempDir, async () => {
      expect(isProjectOnboardingComplete()).toBe(true)
    })
  })

  test('is complete from a nested cwd when repo instructions exist in an ancestor directory', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-onboarding-'))
    const nestedDir = join(tempDir, 'packages', 'app')
    await writeFile(join(tempDir, 'AGENTS.md'), '# AGENTS.md\n')
    await mkdir(nestedDir, { recursive: true })
    await writeFile(join(nestedDir, 'index.ts'), 'export {}\n')

    await runWithCwdOverride(nestedDir, async () => {
      expect(isProjectOnboardingComplete()).toBe(true)
    })
  })
})
