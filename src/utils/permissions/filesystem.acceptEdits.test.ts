import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { setOriginalCwd, getOriginalCwd } from '../../bootstrap/state.js'
import type { Tool } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { applyPermissionUpdate } from './PermissionUpdate.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { checkWritePermissionForTool } from './filesystem.js'

const editTool = {
  name: FILE_EDIT_TOOL_NAME,
  getPath(input: { file_path?: unknown }) {
    return String(input.file_path)
  },
} as unknown as Tool<{ file_path: string }>

function permissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'acceptEdits',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

let originalCwd: string
let tempDir: string

beforeEach(async () => {
  originalCwd = getOriginalCwd()
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-perms-'))
  setOriginalCwd(tempDir)
})

afterEach(async () => {
  setOriginalCwd(originalCwd)
  await rm(tempDir, { recursive: true, force: true })
})

test('acceptEdits allows normal writes inside the working directory', () => {
  const filePath = join(tempDir, 'src.ts')
  const decision = checkWritePermissionForTool(
    editTool,
    { file_path: filePath },
    permissionContext(),
  )

  expect(decision.behavior).toBe('allow')
})

test('protected file session approval sticks to the exact file only', () => {
  const envPath = join(tempDir, '.mcp.json')
  const firstDecision = checkWritePermissionForTool(
    editTool,
    { file_path: envPath },
    permissionContext(),
  )

  expect(firstDecision.behavior).toBe('ask')
  expect(firstDecision.suggestions).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: FILE_EDIT_TOOL_NAME, ruleContent: '/.mcp.json' }],
      behavior: 'allow',
      destination: 'session',
    },
  ])

  const updatedContext = applyPermissionUpdate(
    permissionContext(),
    firstDecision.suggestions![0]!,
  )
  const secondDecision = checkWritePermissionForTool(
    editTool,
    { file_path: envPath },
    updatedContext,
  )
  const otherSensitiveFileDecision = checkWritePermissionForTool(
    editTool,
    { file_path: join(tempDir, '.gitconfig') },
    updatedContext,
  )

  expect(secondDecision.behavior).toBe('allow')
  expect(otherSensitiveFileDecision.behavior).toBe('ask')
})

test('protected file session approval follows the approved symlink target only', async () => {
  const approvedTarget = join(tempDir, '.mcp.json')
  const retargetedFile = join(tempDir, '.gitconfig')
  const linkPath = join(tempDir, 'approved-link')
  await writeFile(approvedTarget, '{}')
  await writeFile(retargetedFile, '[user]\n')
  await symlink(approvedTarget, linkPath)

  const firstDecision = checkWritePermissionForTool(
    editTool,
    { file_path: linkPath },
    permissionContext(),
  )

  expect(firstDecision.behavior).toBe('ask')
  expect(firstDecision.suggestions).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: FILE_EDIT_TOOL_NAME, ruleContent: '/.mcp.json' }],
      behavior: 'allow',
      destination: 'session',
    },
  ])

  const updatedContext = applyPermissionUpdate(
    permissionContext(),
    firstDecision.suggestions![0]!,
  )
  expect(
    checkWritePermissionForTool(
      editTool,
      { file_path: linkPath },
      updatedContext,
    ).behavior,
  ).toBe('allow')

  await unlink(linkPath)
  await symlink(retargetedFile, linkPath)

  expect(
    checkWritePermissionForTool(
      editTool,
      { file_path: linkPath },
      updatedContext,
    ).behavior,
  ).toBe('ask')
})
