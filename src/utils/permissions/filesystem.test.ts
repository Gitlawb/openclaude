import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type { z } from 'zod/v4'

import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  assistantMessage,
  makeAppStateWithPermissionContext,
  makePermissionContext,
  makeToolUseContext,
} from '../../test/permissionTestHelpers.js'
import type { AnyObject, Tool, ToolPermissionContext } from '../../Tool.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { NotebookEditTool } from '../../tools/NotebookEditTool/NotebookEditTool.js'
import { applyPermissionUpdates } from './PermissionUpdate.js'
import { checkWritePermissionForTool } from './filesystem.js'
import { hasPermissionsToUseTool } from './permissions.js'

const fileWriteTools = [FileEditTool, FileWriteTool, NotebookEditTool]

async function checkToolPermission<Input extends AnyObject>(
  tool: Tool<Input>,
  input: z.infer<Input>,
  toolPermissionContext: ToolPermissionContext,
  toolUseID: string,
) {
  return hasPermissionsToUseTool(
    tool,
    input,
    makeToolUseContext(
      makeAppStateWithPermissionContext(toolPermissionContext),
      fileWriteTools,
    ),
    assistantMessage,
    toolUseID,
  )
}

function linkDirectory(target: string, path: string) {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('file write permissions', () => {
  let originalCwd: string
  let workspace: string

  beforeAll(async () => {
    await acquireSharedMutationLock('utils/permissions/filesystem.test.ts')
  })

  afterAll(() => {
    releaseSharedMutationLock()
  })

  beforeEach(() => {
    originalCwd = getOriginalCwd()
    workspace = mkdtempSync(join(tmpdir(), 'openclaude-permissions-'))
    setOriginalCwd(workspace)
  })

  afterEach(() => {
    setOriginalCwd(originalCwd)
    rmSync(workspace, { recursive: true, force: true })
  })

  test('allows FileEdit edits inside the working directory in acceptEdits mode', async () => {
    const filePath = join(workspace, 'src', 'index.ts')
    mkdirSync(join(workspace, 'src'))
    writeFileSync(filePath, 'const value = 1\n')

    const result = await checkToolPermission(
      FileEditTool,
      {
        file_path: filePath,
        old_string: '1',
        new_string: '2',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_file_edit_accept_edits',
    )

    expect(result.behavior).toBe('allow')
  })

  test('allows FileWrite updates inside the working directory in acceptEdits mode', async () => {
    const filePath = join(workspace, 'package.json')
    writeFileSync(filePath, '{}\n')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: '{"private": true}\n',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_file_write_update_accept_edits',
    )

    expect(result.behavior).toBe('allow')
  })

  test('allows FileWrite creates inside the working directory in acceptEdits mode', async () => {
    const filePath = join(workspace, 'new-file.ts')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_file_write_create_accept_edits',
    )

    expect(result.behavior).toBe('allow')
  })

  test('allows NotebookEdit updates inside the working directory in acceptEdits mode', async () => {
    const filePath = join(workspace, 'analysis.ipynb')
    writeFileSync(filePath, '{"cells":[],"metadata":{},"nbformat":4}\n')

    const result = await checkToolPermission(
      NotebookEditTool,
      {
        notebook_path: filePath,
        cell_id: 'cell-1',
        new_source: 'print("ok")',
        cell_type: 'code',
        edit_mode: 'replace',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_notebook_edit_accept_edits',
    )

    expect(result.behavior).toBe('allow')
  })

  test('keeps read permissions unchanged for in-workspace trailing-dot segments', async () => {
    const docsDir = join(workspace, 'docs.')
    const filePath = join(docsDir, 'note.md')
    mkdirSync(docsDir)
    writeFileSync(filePath, '# note\n')

    const result = await checkToolPermission(
      FileReadTool,
      {
        file_path: filePath,
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_file_read_trailing_dot_segment',
    )

    expect(result.behavior).toBe('allow')
  })

  test('allows edits and writes inside additional working directories in acceptEdits mode', async () => {
    const additionalWorkspace = mkdtempSync(join(tmpdir(), 'openclaude-additional-'))
    try {
      const editPath = join(additionalWorkspace, 'edit.ts')
      const writePath = join(additionalWorkspace, 'write.ts')
      writeFileSync(editPath, 'export const value = 1\n')
      const toolPermissionContext = makePermissionContext({
        mode: 'acceptEdits',
        additionalWorkingDirectories: new Map([
          [
            additionalWorkspace,
            { path: additionalWorkspace, source: 'cliArg' },
          ],
        ]),
      })

      const editResult = await checkToolPermission(
        FileEditTool,
        {
          file_path: editPath,
          old_string: '1',
          new_string: '2',
        },
        toolPermissionContext,
        'toolu_file_edit_additional_accept_edits',
      )
      const writeResult = await checkToolPermission(
        FileWriteTool,
        {
          file_path: writePath,
          content: 'export const value = 1\n',
        },
        toolPermissionContext,
        'toolu_file_write_additional_accept_edits',
      )
      const defaultResult = await checkToolPermission(
        FileWriteTool,
        {
          file_path: writePath,
          content: 'export const value = 2\n',
        },
        {
          ...toolPermissionContext,
          mode: 'default',
        },
        'toolu_file_write_additional_default',
      )

      expect(editResult.behavior).toBe('allow')
      expect(writeResult.behavior).toBe('allow')
      expect(defaultResult.behavior).toBe('ask')
    } finally {
      rmSync(additionalWorkspace, { recursive: true, force: true })
    }
  })

  test('asks for the same normal file write in default mode', async () => {
    const filePath = join(workspace, 'default-mode.ts')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({ mode: 'default' }),
      'toolu_file_write_default',
    )

    expect(result.behavior).toBe('ask')
  })

  test('asks for normal writes outside allowed working directories in acceptEdits mode', async () => {
    const outsideWorkspace = mkdtempSync(join(tmpdir(), 'openclaude-outside-'))
    try {
      const filePath = join(outsideWorkspace, 'regular.ts')

      const result = await checkToolPermission(
        FileWriteTool,
        {
          file_path: filePath,
          content: 'export const value = 1\n',
        },
        makePermissionContext({ mode: 'acceptEdits' }),
        'toolu_file_write_outside_accept_edits',
      )

      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('workingDir')
    } finally {
      rmSync(outsideWorkspace, { recursive: true, force: true })
    }
  })

  test('deny rules still win in acceptEdits mode', async () => {
    const filePath = join(workspace, 'blocked.ts')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysDenyRules: {
          session: ['Edit(/blocked.ts)'],
        },
      }),
      'toolu_file_write_deny_accept_edits',
    )

    expect(result.behavior).toBe('deny')
  })

  test.each([
    ['.git config', ['.git', 'config']],
    ['VS Code settings', ['.vscode', 'settings.json']],
    ['JetBrains settings', ['.idea', 'workspace.xml']],
    ['Claude settings', ['.claude', 'settings.json']],
    ['OpenClaude settings', ['.openclaude', 'settings.json']],
    ['bash startup file', ['.bashrc']],
    ['bash profile startup file', ['.bash_profile']],
    ['zsh startup file', ['.zshrc']],
    ['zsh profile startup file', ['.zprofile']],
    ['profile startup file', ['.profile']],
    ['git config file', ['.gitconfig']],
    ['MCP config file', ['.mcp.json']],
    ['suspicious Windows short path', ['GIT~1', 'config']],
    ['Windows reserved device file', ['NUL.txt']],
    ['Windows reserved device file with extension', ['COM1.log']],
    ['Windows CONIN device file', ['CONIN$']],
    ['Windows CONOUT device file with extension', ['CONOUT$.txt']],
    ['Windows superscript COM device file', ['COM\u00b9.log']],
    ['Windows superscript LPT device file', ['LPT\u00b2']],
    ['Windows canonicalized .git directory with trailing dot', ['.git.', 'config']],
    ['Windows canonicalized .git directory with trailing space', ['.git ', 'config']],
    [
      'Windows canonicalized VS Code directory with trailing dot',
      ['.vscode.', 'settings.json'],
    ],
    [
      'Windows canonicalized Claude directory with trailing space',
      ['.claude ', 'settings.json'],
    ],
  ])('still asks for sensitive path in acceptEdits mode: %s', async (_, parts) => {
    const filePath = join(workspace, ...parts)

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: '{}\n',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      `toolu_file_write_sensitive_${parts.join('_')}`,
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('asks for trailing-dot path segments in acceptEdits mode', async () => {
    const docsDir = join(workspace, 'docs.')
    const filePath = join(docsDir, 'note.md')
    mkdirSync(docsDir)

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: '# Notes\n',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_file_write_trailing_dot',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('trailing-dot paths do not bypass deny rules in acceptEdits mode', async () => {
    const filePath = join(workspace, 'blocked.ts.')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysDenyRules: {
          session: ['Edit(/blocked.ts)'],
        },
      }),
      'toolu_file_write_deny_trailing_dot',
    )

    expect(result.behavior).toBe('deny')
    expect(result.decisionReason?.type).toBe('rule')
  })

  test('mixed-case paths do not bypass deny rules in acceptEdits mode', async () => {
    const filePath = join(workspace, 'BLOCKED.TS')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysDenyRules: {
          session: ['Edit(/blocked.ts)'],
        },
      }),
      'toolu_file_write_deny_mixed_case',
    )

    expect(result.behavior).toBe('deny')
    expect(result.decisionReason?.type).toBe('rule')
  })

  test('Windows short-name aliases do not downgrade deny rules in acceptEdits mode', async () => {
    const filePath = join(workspace, 'BLOCKE~1.TS')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysDenyRules: {
          session: ['Edit(/blocked-file.ts)'],
        },
      }),
      'toolu_file_write_deny_short_name_alias',
    )

    expect(result.behavior).toBe('deny')
    expect(result.decisionReason?.type).toBe('rule')
  })

  test('mixed-case paths do not bypass ask rules in acceptEdits mode', async () => {
    const filePath = join(workspace, 'CONFIRM.TS')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAskRules: {
          session: ['Edit(/confirm.ts)'],
        },
      }),
      'toolu_file_write_ask_mixed_case',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('rule')
  })

  test('trailing-space paths still require manual approval in acceptEdits mode', async () => {
    const filePath = join(workspace, 'confirm.ts ')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAskRules: {
          session: ['Edit(/confirm.ts)'],
        },
      }),
      'toolu_file_write_ask_trailing_space',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('still asks for UNC paths in acceptEdits mode', async () => {
    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: '//server/share/file.ts',
        content: 'export const value = 1\n',
      },
      makePermissionContext({ mode: 'acceptEdits' }),
      'toolu_file_write_unc_accept_edits',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('still asks when a workspace symlink resolves outside allowed working directories', async () => {
    const outsideWorkspace = mkdtempSync(join(tmpdir(), 'openclaude-outside-'))
    try {
      const targetPath = join(outsideWorkspace, 'target.ts')
      const linkDir = join(workspace, 'linked-outside')
      const linkedPath = join(linkDir, 'target.ts')
      writeFileSync(targetPath, 'export const target = true\n')
      linkDirectory(outsideWorkspace, linkDir)

      const result = await checkToolPermission(
        FileWriteTool,
        {
          file_path: linkedPath,
          content: 'export const value = 1\n',
        },
        makePermissionContext({ mode: 'acceptEdits' }),
        'toolu_file_write_linked_outside_accept_edits',
      )

      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('workingDir')
    } finally {
      rmSync(outsideWorkspace, { recursive: true, force: true })
    }
  })

  test('still asks when creating through a workspace symlink outside allowed working directories', async () => {
    const outsideWorkspace = mkdtempSync(join(tmpdir(), 'openclaude-outside-'))
    try {
      const linkDir = join(workspace, 'linked-outside-create')
      const linkedPath = join(linkDir, 'new.ts')
      linkDirectory(outsideWorkspace, linkDir)

      const result = await checkToolPermission(
        FileWriteTool,
        {
          file_path: linkedPath,
          content: 'export const value = 1\n',
        },
        makePermissionContext({ mode: 'acceptEdits' }),
        'toolu_file_write_linked_outside_create_accept_edits',
      )

      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('workingDir')
    } finally {
      rmSync(outsideWorkspace, { recursive: true, force: true })
    }
  })

  test('still asks when a workspace symlink resolves to a sensitive path', async () => {
    const outsideWorkspace = mkdtempSync(join(tmpdir(), 'openclaude-sensitive-'))
    try {
      const gitDir = join(outsideWorkspace, '.git')
      const targetPath = join(gitDir, 'config')
      const linkDir = join(workspace, 'linked-git')
      const linkedPath = join(linkDir, 'config')
      mkdirSync(gitDir)
      writeFileSync(targetPath, '[core]\n')
      linkDirectory(gitDir, linkDir)

      const result = await checkToolPermission(
        FileWriteTool,
        {
          file_path: linkedPath,
          content: '[core]\nrepositoryformatversion = 0\n',
        },
        makePermissionContext({ mode: 'acceptEdits' }),
        'toolu_file_write_linked_sensitive_accept_edits',
      )

      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('safetyCheck')
    } finally {
      rmSync(outsideWorkspace, { recursive: true, force: true })
    }
  })

  test('still asks when creating through a workspace symlink into a sensitive path', async () => {
    const outsideWorkspace = mkdtempSync(join(tmpdir(), 'openclaude-sensitive-'))
    try {
      const gitDir = join(outsideWorkspace, '.git')
      const linkDir = join(workspace, 'linked-git-create')
      const linkedPath = join(linkDir, 'hooks', 'post-commit')
      mkdirSync(gitDir)
      linkDirectory(gitDir, linkDir)

      const result = await checkToolPermission(
        FileWriteTool,
        {
          file_path: linkedPath,
          content: '#!/bin/sh\n',
        },
        makePermissionContext({ mode: 'acceptEdits' }),
        'toolu_file_write_linked_sensitive_create_accept_edits',
      )

      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('safetyCheck')
    } finally {
      rmSync(outsideWorkspace, { recursive: true, force: true })
    }
  })

  test('safety checks still win over explicit allow rules in acceptEdits mode', () => {
    const gitDir = join(workspace, '.git')
    const filePath = join(gitDir, 'config')
    mkdirSync(gitDir)

    const result = checkWritePermissionForTool(
      FileWriteTool,
      {
        file_path: filePath,
        content: '[core]\nrepositoryformatversion = 0\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAllowRules: {
          session: ['Edit(/.git/**)'],
        },
      }),
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('pipeline safety checks still win over broad explicit allow rules', async () => {
    const gitDir = join(workspace, '.git')
    const filePath = join(gitDir, 'config')
    mkdirSync(gitDir)

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: '[core]\nrepositoryformatversion = 0\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAllowRules: {
          session: ['Edit'],
        },
      }),
      'toolu_write_git_config_allow_rule',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('session ask rules still override acceptEdits for normal working directory writes', async () => {
    const filePath = join(workspace, 'session-ask.ts')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAskRules: {
          session: ['Edit(/session-ask.ts)'],
        },
      }),
      'toolu_file_write_session_ask',
    )

    expect(result.behavior).toBe('ask')
  })

  test('explicit ask rules still override acceptEdits for normal working directory writes', async () => {
    const filePath = join(workspace, 'persistent-ask.ts')

    const result = await checkToolPermission(
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAskRules: {
          cliArg: ['Edit(/persistent-ask.ts)'],
        },
      }),
      'toolu_file_write_explicit_ask',
    )

    expect(result.behavior).toBe('ask')
  })

  test('tool-level session ask rules still override acceptEdits for normal file edits', async () => {
    const filePath = join(workspace, 'pipeline-session-ask.ts')
    const appState = makeAppStateWithPermissionContext(
      makePermissionContext({
        mode: 'acceptEdits',
        alwaysAskRules: {
          session: ['Edit'],
        },
      }),
    )

    const result = await hasPermissionsToUseTool(
      FileEditTool,
      {
        file_path: filePath,
        old_string: '',
        new_string: 'export const value = 1\n',
      },
      makeToolUseContext(appState, fileWriteTools),
      assistantMessage,
      'toolu_edit',
    )

    expect(result.behavior).toBe('ask')
  })

  test('applying the session acceptEdits suggestion allows the next normal file write', async () => {
    const filePath = join(workspace, 'session-update.ts')
    const appState = makeAppStateWithPermissionContext(
      makePermissionContext({ mode: 'default' }),
    )
    const toolUseContext = makeToolUseContext(appState, fileWriteTools)
    const input = {
      file_path: filePath,
      content: 'export const value = 1\n',
    }

    const firstResult = await hasPermissionsToUseTool(
      FileWriteTool,
      input,
      toolUseContext,
      assistantMessage,
      'toolu_write_1',
    )

    expect(firstResult.behavior).toBe('ask')
    if (firstResult.behavior !== 'ask') {
      throw new Error(`Expected ask, got ${firstResult.behavior}`)
    }
    expect(firstResult.suggestions).toContainEqual({
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'session',
    })

    toolUseContext.setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdates(
        prev.toolPermissionContext,
        firstResult.suggestions ?? [],
      ),
    }))

    const secondResult = await hasPermissionsToUseTool(
      FileWriteTool,
      input,
      toolUseContext,
      assistantMessage,
      'toolu_write_2',
    )

    expect(secondResult.behavior).toBe('allow')
  })
})
