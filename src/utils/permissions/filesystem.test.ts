import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import type { ToolPermissionContext } from '../../types/permissions.js'
import {
  getOriginalCwd,
  getProjectRoot,
  setOriginalCwd,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import { checkWritePermissionForTool } from './filesystem.js'

const writeInputSchema = z.object({
  file_path: z.string(),
})

describe('auto-memory write permissions', () => {
  let originalProjectRoot: string
  let originalMemoryPathOverride: string | undefined
  let projectDir: string

  beforeEach(async () => {
    originalProjectRoot = getProjectRoot()
    originalMemoryPathOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    getAutoMemPath.cache.clear?.()
    projectDir = await mkdtemp(join(tmpdir(), 'openclaude-memory-perms-'))
    setProjectRoot(projectDir)
  })

  afterEach(async () => {
    setProjectRoot(originalProjectRoot)
    if (originalMemoryPathOverride === undefined) {
      delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    } else {
      process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE =
        originalMemoryPathOverride
    }
    getAutoMemPath.cache.clear?.()
    await rm(projectDir, { recursive: true, force: true })
  })

  test('requires approval for default auto-memory writes', () => {
    const result = checkWritePermissionForTool(
      writeTool,
      { file_path: join(getAutoMemPath(), 'user_role.md') },
      permissionContext('bypassPermissions'),
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({
      type: 'safetyCheck',
      reason: 'Persistent memory writes require explicit approval',
    })
  })

  test('requires approval for overridden auto-memory writes', async () => {
    const overrideDir = await mkdtemp(join(tmpdir(), 'openclaude-memory-'))
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = overrideDir
    getAutoMemPath.cache.clear?.()

    try {
      const result = checkWritePermissionForTool(
        writeTool,
        { file_path: join(getAutoMemPath(), 'user_role.md') },
        permissionContext('bypassPermissions'),
      )

      expect(result.behavior).toBe('ask')
      expect(result.decisionReason).toMatchObject({
        type: 'safetyCheck',
        reason: 'Persistent memory writes require explicit approval',
      })
    } finally {
      await rm(overrideDir, { recursive: true, force: true })
    }
  })
})

const writeTool = createToolFixture(writeInputSchema, {
  name: 'Write',
  getPath(input: { file_path: string }) {
    return input.file_path
  },
})

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
