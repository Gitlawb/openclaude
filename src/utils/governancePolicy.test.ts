import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getOriginalCwd,
  setAllowedSettingSources,
  setOriginalCwd,
} from '../bootstrap/state.js'
import { SETTING_SOURCES } from './settings/constants.js'
import { resetSettingsCache } from './settings/settingsCache.js'

let originalCwd: string
let projectDir: string

async function writeSettings(
  filename: 'settings.json' | 'settings.local.json',
  settings: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(projectDir, '.openclaude'), { recursive: true })
  await writeFile(
    join(projectDir, '.openclaude', filename),
    JSON.stringify(settings),
  )
  resetSettingsCache()
}

beforeEach(async () => {
  originalCwd = getOriginalCwd()
  projectDir = await mkdtemp(join(tmpdir(), 'openclaude-governance-'))
  setOriginalCwd(projectDir)
  setAllowedSettingSources([...SETTING_SOURCES])
  resetSettingsCache()
})

afterEach(async () => {
  setOriginalCwd(originalCwd)
  setAllowedSettingSources([...SETTING_SOURCES])
  resetSettingsCache()
  await rm(projectDir, { recursive: true, force: true })
})

test('memory approval is required when any settings source opts in', async () => {
  await writeSettings('settings.json', {
    memory: { requireApprovalBeforeWrite: true },
  })

  const { isMemoryWriteApprovalRequired } = await import('./governancePolicy.js')
  expect(isMemoryWriteApprovalRequired()).toBe(true)
})

test('memory approval is required by default', async () => {
  const { isMemoryWriteApprovalRequired } = await import('./governancePolicy.js')
  expect(isMemoryWriteApprovalRequired()).toBe(true)
})

test('memory approval can be explicitly disabled when no source requires it', async () => {
  await writeSettings('settings.json', {
    memory: { requireApprovalBeforeWrite: false },
  })

  const { isMemoryWriteApprovalRequired } = await import('./governancePolicy.js')
  expect(isMemoryWriteApprovalRequired()).toBe(false)
})

test('generated attribution block settings are evaluated independently', async () => {
  await writeSettings('settings.json', {
    git: { addAICoAuthor: false },
  })

  const {
    isGeneratedCommitAttributionBlocked,
    isGeneratedPrAttributionBlocked,
  } = await import('./governancePolicy.js')
  expect(isGeneratedCommitAttributionBlocked()).toBe(true)
  expect(isGeneratedPrAttributionBlocked()).toBe(false)
})

test('forbidden commit message patterns are combined across settings sources', async () => {
  await writeSettings('settings.json', {
    git: { forbiddenCommitMessagePatterns: ['Generated with'] },
  })
  await writeSettings('settings.local.json', {
    git: { forbiddenCommitMessagePatterns: ['Co-Authored-By:'] },
  })

  const { findForbiddenCommitMessagePattern } = await import(
    './governancePolicy.js'
  )
  expect(
    findForbiddenCommitMessagePattern(
      'fix: policy\n\nco-authored-by: OpenClaude <x@y.z>',
    ),
  ).toBe('Co-Authored-By:')
})
