import {
  mkdirSync,
  mkdtempSync,
  rmSync,
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

import { runWithSdkContext } from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  assistantMessage,
  makeAppStateWithPermissionContext,
  makeToolUseContext,
} from '../../test/permissionTestHelpers.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { NotebookEditTool } from '../../tools/NotebookEditTool/NotebookEditTool.js'
import type { SessionId } from '../../types/ids.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import type { QueryPermissionMode, SDKPermissionRequestMessage } from './shared.js'
import {
  buildPermissionContext,
  createDefaultCanUseTool,
  createExternalCanUseTool,
  createPermissionTarget,
} from './permissions.js'
import { query } from './query.js'
import { unstable_v2_createSession } from './v2.js'

const permissionTestTools = [
  FileEditTool,
  FileReadTool,
  FileWriteTool,
  NotebookEditTool,
]
const quietLogger = { warn: () => {} }

type SdkEngineConfig = {
  canUseTool: CanUseToolFn
  getAppState: () => ReturnType<typeof makeAppStateWithPermissionContext>
}

function getQueryEngineConfig(sdkQuery: unknown): SdkEngineConfig {
  return (sdkQuery as { _engine: { config: SdkEngineConfig } })._engine.config
}

function getSessionEngineConfig(session: unknown): SdkEngineConfig {
  return (session as { _engine: { config: SdkEngineConfig } })._engine.config
}

function runWithSdkTestContext<T>(
  cwd: string,
  fn: () => T,
  sessionId: string = 'sdk-test-session',
): T {
  return runWithSdkContext(
    {
      sessionId: sessionId as SessionId,
      sessionProjectDir: null,
      cwd,
      originalCwd: cwd,
    },
    fn,
  )
}

function checkSdkToolPermission(
  cwd: string,
  canUseTool: CanUseToolFn,
  tool: Parameters<CanUseToolFn>[0],
  input: Parameters<CanUseToolFn>[1],
  toolUseContext: Parameters<CanUseToolFn>[2],
  toolUseID: string,
) {
  return runWithSdkTestContext(cwd, () =>
    canUseTool(tool, input, toolUseContext, assistantMessage, toolUseID),
  )
}

function makeSdkPermissionHarness({
  cwd,
  permissionMode,
  permissionContext,
}: {
  cwd: string
  permissionMode?: QueryPermissionMode
  permissionContext?: ToolPermissionContext
}) {
  const toolPermissionContext =
    permissionContext ??
    buildPermissionContext({
      cwd,
      permissionMode,
    })
  const appState = makeAppStateWithPermissionContext(toolPermissionContext)
  const toolUseContext = makeToolUseContext(appState, permissionTestTools)
  const permissionTarget = createPermissionTarget()
  const requests: SDKPermissionRequestMessage[] = []

  const canUseTool = createExternalCanUseTool(
    undefined,
    createDefaultCanUseTool(toolPermissionContext, quietLogger),
    permissionTarget,
    request => {
      requests.push(request)
      permissionTarget.pendingPermissionPrompts
        .get(request.tool_use_id)
        ?.resolve({
          behavior: 'deny',
          message: 'host denied permission request',
          decisionReason: { type: 'mode', mode: 'default' },
        })
    },
    undefined,
    50,
    'sdk-test-session',
    quietLogger,
    hasPermissionsToUseTool,
  )

  return {
    canUseTool,
    requests,
    toolUseContext,
  }
}

describe('SDK file write permissions', () => {
  let workspace: string

  beforeAll(async () => {
    await acquireSharedMutationLock('entrypoints/sdk/permissions.test.ts')
  })

  afterAll(() => {
    releaseSharedMutationLock()
  })

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'openclaude-sdk-permissions-'))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  test('does not emit permission requests for FileEdit in acceptEdits mode', async () => {
    const filePath = join(workspace, 'src', 'index.ts')
    mkdirSync(join(workspace, 'src'))
    writeFileSync(filePath, 'const value = 1\n')
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileEditTool,
      {
        file_path: filePath,
        old_string: '1',
        new_string: '2',
      },
      toolUseContext,
      'toolu_sdk_file_edit',
    )

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })

  test('does not emit permission requests for FileWrite updates in acceptEdits mode', async () => {
    const filePath = join(workspace, 'package.json')
    writeFileSync(filePath, '{}\n')
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: '{"private": true}\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_update',
    )

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })

  test('does not emit permission requests for FileWrite creates in acceptEdits mode', async () => {
    const filePath = join(workspace, 'new-file.ts')
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_create',
    )

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })

  test('query() wires acceptEdits file writes through the internal resolver', async () => {
    const filePath = join(workspace, 'query-entrypoint.ts')
    const requests: SDKPermissionRequestMessage[] = []
    const sdkQuery = query({
      prompt: 'test prompt',
      options: {
        cwd: workspace,
        permissionMode: 'acceptEdits',
        onPermissionRequest: request => {
          requests.push(request)
        },
      },
    })
    const config = getQueryEngineConfig(sdkQuery)

    const result = await runWithSdkTestContext(
      workspace,
      () =>
        config.canUseTool(
          FileWriteTool,
          {
            file_path: filePath,
            content: 'export const value = 1\n',
          },
          makeToolUseContext(config.getAppState(), permissionTestTools),
          assistantMessage,
          'toolu_sdk_query_file_write',
        ),
      sdkQuery.sessionId,
    )

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })

  test('unstable_v2_createSession wires acceptEdits file writes through the internal resolver', async () => {
    const filePath = join(workspace, 'v2-entrypoint.ts')
    const requests: SDKPermissionRequestMessage[] = []
    const session = unstable_v2_createSession({
      cwd: workspace,
      permissionMode: 'acceptEdits',
      onPermissionRequest: request => {
        requests.push(request)
      },
    })
    const config = getSessionEngineConfig(session)

    try {
      const result = await runWithSdkTestContext(
        workspace,
        () =>
          config.canUseTool(
            FileWriteTool,
            {
              file_path: filePath,
              content: 'export const value = 1\n',
            },
            makeToolUseContext(config.getAppState(), permissionTestTools),
            assistantMessage,
            'toolu_sdk_v2_file_write',
          ),
        session.sessionId,
      )

      expect(result.behavior).toBe('allow')
      expect(requests).toHaveLength(0)
    } finally {
      session.close()
    }
  })

  test('does not emit permission requests for NotebookEdit in acceptEdits mode', async () => {
    const filePath = join(workspace, 'analysis.ipynb')
    writeFileSync(filePath, '{"cells":[],"metadata":{},"nbformat":4}\n')
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      NotebookEditTool,
      {
        notebook_path: filePath,
        cell_id: 'cell-1',
        new_source: 'print("ok")',
        cell_type: 'code',
        edit_mode: 'replace',
      },
      toolUseContext,
      'toolu_sdk_notebook_edit',
    )

    expect(result.behavior).toBe('allow')
    expect(requests).toHaveLength(0)
  })

  test('still emits permission requests for normal writes in default mode', async () => {
    const filePath = join(workspace, 'default-mode.ts')
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'default',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_default',
    )

    expect(result.behavior).toBe('deny')
    expect(requests).toHaveLength(1)
  })

  test('does not emit permission requests when explicit deny rules match in acceptEdits mode', async () => {
    const filePath = join(workspace, 'blocked.ts')
    const permissionContext = buildPermissionContext({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionContext: {
        ...permissionContext,
        alwaysDenyRules: {
          session: ['Edit(/blocked.ts)'],
        },
      },
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_deny',
    )

    expect(result.behavior).toBe('deny')
    expect(requests).toHaveLength(0)
  })

  test('does not emit permission requests for canonicalized denied paths in acceptEdits mode', async () => {
    const filePath = join(workspace, 'BLOCKED.TS.')
    const permissionContext = buildPermissionContext({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionContext: {
        ...permissionContext,
        alwaysDenyRules: {
          session: ['Edit(/blocked.ts)'],
        },
      },
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_canonical_deny',
    )

    expect(result.behavior).toBe('deny')
    expect(requests).toHaveLength(0)
  })

  test('does not emit permission requests for Windows short-name denied paths in acceptEdits mode', async () => {
    const filePath = join(workspace, 'BLOCKE~1.TS')
    const permissionContext = buildPermissionContext({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionContext: {
        ...permissionContext,
        alwaysDenyRules: {
          session: ['Edit(/blocked-file.ts)'],
        },
      },
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_short_name_deny',
    )

    expect(result.behavior).toBe('deny')
    expect(requests).toHaveLength(0)
  })

  test('still emits permission requests for safety checks in acceptEdits mode', async () => {
    const gitDir = join(workspace, '.git')
    const filePath = join(gitDir, 'config')
    mkdirSync(gitDir)
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileWriteTool,
      {
        file_path: filePath,
        content: '[core]\nrepositoryformatversion = 0\n',
      },
      toolUseContext,
      'toolu_sdk_file_write_safety',
    )

    expect(result.behavior).toBe('deny')
    expect(requests).toHaveLength(1)
  })

  test('still emits permission requests for FileRead in acceptEdits mode', async () => {
    const filePath = join(workspace, 'readme.md')
    writeFileSync(filePath, '# Read me\n')
    const { canUseTool, requests, toolUseContext } = makeSdkPermissionHarness({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })

    const result = await checkSdkToolPermission(
      workspace,
      canUseTool,
      FileReadTool,
      {
        file_path: filePath,
      },
      toolUseContext,
      'toolu_sdk_file_read',
    )

    expect(result.behavior).toBe('deny')
    expect(requests).toHaveLength(1)
  })

  test('keeps SDK secure-by-default behavior without external permission requests', async () => {
    const filePath = join(workspace, 'secure-default.ts')
    const permissionContext = buildPermissionContext({
      cwd: workspace,
      permissionMode: 'acceptEdits',
    })
    const permissionTarget = createPermissionTarget()
    const canUseTool = createExternalCanUseTool(
      undefined,
      createDefaultCanUseTool(permissionContext, quietLogger),
      permissionTarget,
      undefined,
      undefined,
      50,
      'sdk-test-session',
      quietLogger,
      hasPermissionsToUseTool,
    )

    const result = await runWithSdkTestContext(
      workspace,
      () =>
        canUseTool(
          FileWriteTool,
          {
            file_path: filePath,
            content: 'export const value = 1\n',
          },
          makeToolUseContext(
            makeAppStateWithPermissionContext(permissionContext),
            permissionTestTools,
          ),
          assistantMessage,
          'toolu_sdk_file_write_secure_default',
        ),
      'sdk-test-session',
    )

    expect(result.behavior).toBe('deny')
  })
})
