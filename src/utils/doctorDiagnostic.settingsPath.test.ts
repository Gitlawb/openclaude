import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { getOriginalCwd, setOriginalCwd } from '../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { detectStaleProjectSettingsPaths } from './doctorDiagnostic.js'

let tempDir: string | null = null
let originalCwd: string | null = null

function createProject(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-settings-drift-'))
  return tempDir
}

function writeJson(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}', 'utf8')
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/doctorDiagnostic.settingsPath.test.ts')
  originalCwd = getOriginalCwd()
})

afterEach(() => {
  try {
    if (originalCwd) {
      setOriginalCwd(originalCwd)
      originalCwd = null
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('detectStaleProjectSettingsPaths', () => {
  test('warns when legacy project settings exist without canonical settings', async () => {
    const project = createProject()
    writeJson(join(project, '.claude', 'settings.json'))

    const warning = await detectStaleProjectSettingsPaths(project)

    expect(warning).toEqual({
      issue:
        'Legacy project settings file .claude/settings.json found, but OpenClaude reads .openclaude/settings.json',
      fix:
        'Move or copy .claude/settings.json to .openclaude/settings.json if you intended OpenClaude to use those project settings.',
    })
  })

  test('does not warn when the matching canonical project settings file exists', async () => {
    const project = createProject()
    writeJson(join(project, '.claude', 'settings.json'))
    writeJson(join(project, '.openclaude', 'settings.json'))

    await expect(detectStaleProjectSettingsPaths(project)).resolves.toBeNull()
  })

  test('does not warn when no legacy project settings files exist', async () => {
    const project = createProject()

    await expect(detectStaleProjectSettingsPaths(project)).resolves.toBeNull()
  })

  test('does not warn when only canonical settings files exist', async () => {
    const project = createProject()
    writeJson(join(project, '.openclaude', 'settings.json'))
    writeJson(join(project, '.openclaude', 'settings.local.json'))

    await expect(detectStaleProjectSettingsPaths(project)).resolves.toBeNull()
  })

  test('warns independently for legacy local settings', async () => {
    const project = createProject()
    writeJson(join(project, '.claude', 'settings.local.json'))

    const warning = await detectStaleProjectSettingsPaths(project)

    expect(warning?.issue).toContain('.claude/settings.local.json')
    expect(warning?.issue).toContain('.openclaude/settings.local.json')
  })

  test('warns about both legacy settings files when both canonical files are absent', async () => {
    const project = createProject()
    writeJson(join(project, '.claude', 'settings.json'))
    writeJson(join(project, '.claude', 'settings.local.json'))

    const warning = await detectStaleProjectSettingsPaths(project)

    expect(warning?.issue).toContain('.claude/settings.json')
    expect(warning?.issue).toContain('.claude/settings.local.json')
    expect(warning?.issue).toContain('.openclaude/settings.json')
    expect(warning?.issue).toContain('.openclaude/settings.local.json')
  })

  test('uses the settings resolver project root by default', async () => {
    const project = createProject()
    writeJson(join(project, '.claude', 'settings.json'))
    setOriginalCwd(project)

    const warning = await detectStaleProjectSettingsPaths()

    expect(warning?.issue).toContain('.claude/settings.json')
    expect(warning?.issue).toContain('.openclaude/settings.json')
  })
})
