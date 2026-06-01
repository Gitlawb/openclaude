import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Tool } from '../../Tool.js'
import type { ToolPermissionContext } from '../../types/permissions.js'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { checkWritePermissionForTool } from './filesystem.js'

const writeTool = {
  name: 'Write',
  getPath(input: { file_path: string }) {
    return input.file_path
  },
} as Tool<{ file_path: string }>

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

describe('OpenClaude commit message temp file permissions', () => {
  let originalCwd: string
  let projectDir: string

  beforeEach(async () => {
    originalCwd = getOriginalCwd()
    projectDir = await mkdtemp(join(tmpdir(), 'openclaude-perms-'))
    await mkdir(join(projectDir, '.git'))
    setOriginalCwd(projectDir)
  })

  afterEach(async () => {
    setOriginalCwd(originalCwd)
    await rm(projectDir, { recursive: true, force: true })
  })

  test('allows the project-local OPENCLAUDE_COMMIT_MSG file without a safety prompt', () => {
    const result = checkWritePermissionForTool(
      writeTool,
      { file_path: join(projectDir, '.git', 'OPENCLAUDE_COMMIT_MSG') },
      permissionContext('bypassPermissions'),
    )

    expect(result.behavior).toBe('allow')
    expect(result.decisionReason).toMatchObject({
      type: 'other',
      reason: 'OpenClaude commit message file is allowed for writing',
    })
  })

  test('allows the project-local OPENCLAUDE_COMMIT_MSG file in fullAccess mode', () => {
    const result = checkWritePermissionForTool(
      writeTool,
      { file_path: join(projectDir, '.git', 'OPENCLAUDE_COMMIT_MSG') },
      permissionContext('fullAccess'),
    )

    expect(result.behavior).toBe('allow')
    expect(result.decisionReason).toMatchObject({
      type: 'other',
      reason: 'OpenClaude commit message file is allowed for writing',
    })
  })

  test('still prompts for the commit message file in default mode', () => {
    const result = checkWritePermissionForTool(
      writeTool,
      { file_path: join(projectDir, '.git', 'OPENCLAUDE_COMMIT_MSG') },
      permissionContext('default'),
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({ type: 'safetyCheck' })
  })

  test('continues to block other .git files with a safety prompt', () => {
    const result = checkWritePermissionForTool(
      writeTool,
      { file_path: join(projectDir, '.git', 'config') },
      permissionContext('bypassPermissions'),
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({ type: 'safetyCheck' })
  })

  test('does not allow same-named files outside the project git directory', () => {
    const otherDir = join(projectDir, 'other')
    const result = checkWritePermissionForTool(
      writeTool,
      { file_path: join(otherDir, '.git', 'OPENCLAUDE_COMMIT_MSG') },
      permissionContext('bypassPermissions'),
    )

    expect(result.behavior).not.toBe('allow')
  })
})
