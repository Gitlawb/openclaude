import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getOriginalCwd,
  setCwdState,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import type { ToolPermissionContext } from '../../types/permissions.js'
import { isUnsafeDotGitWritePathForPowerShell } from './powershellPermissions.js'

function permissionContext(mode: ToolPermissionContext['mode']) {
  return {
    mode,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable:
      mode === 'bypassPermissions' || mode === 'fullAccess',
  } satisfies ToolPermissionContext
}

describe('PowerShell .git write safety', () => {
  let originalCwd: string
  let projectDir: string

  beforeEach(async () => {
    originalCwd = getOriginalCwd()
    projectDir = await mkdtemp(join(tmpdir(), 'openclaude-ps-perms-'))
    await mkdir(join(projectDir, '.git'))
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
  })

  afterEach(async () => {
    setOriginalCwd(originalCwd)
    setCwdState(originalCwd)
    await rm(projectDir, { recursive: true, force: true })
  })

  test('does not force a .git safety prompt for the commit message temp file in bypass mode', () => {
    expect(
      isUnsafeDotGitWritePathForPowerShell(
        '.git/OPENCLAUDE_COMMIT_MSG',
        permissionContext('bypassPermissions'),
      ),
    ).toBe(false)
  })

  test('does not force a .git safety prompt for the commit message temp file in full access mode', () => {
    expect(
      isUnsafeDotGitWritePathForPowerShell(
        '.git/OPENCLAUDE_COMMIT_MSG',
        permissionContext('fullAccess'),
      ),
    ).toBe(false)
  })

  test('still prompts for the commit message temp file outside dangerous modes', () => {
    expect(
      isUnsafeDotGitWritePathForPowerShell(
        '.git/OPENCLAUDE_COMMIT_MSG',
        permissionContext('default'),
      ),
    ).toBe(true)
  })

  test('still prompts for other .git writes in bypass mode', () => {
    expect(
      isUnsafeDotGitWritePathForPowerShell(
        '.git/config',
        permissionContext('bypassPermissions'),
      ),
    ).toBe(true)
  })
})
