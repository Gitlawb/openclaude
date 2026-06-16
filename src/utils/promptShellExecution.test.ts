import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { BashTool } from '../tools/BashTool/BashTool.js'
import { executeShellCommandsInPrompt } from './promptShellExecution.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalCall = BashTool.call
const originalMapToolResultToToolResultBlockParam =
  BashTool.mapToolResultToToolResultBlockParam

beforeEach(async () => {
  await acquireSharedMutationLock('utils/promptShellExecution.test.ts')
})

afterEach(() => {
  try {
    BashTool.call = originalCall
    BashTool.mapToolResultToToolResultBlockParam =
      originalMapToolResultToToolResultBlockParam
  } finally {
    releaseSharedMutationLock()
  }
})

test('executeShellCommandsInPrompt normalizes null shell output', async () => {
  let normalizedResult:
    | { stdout: string; stderr: string; interrupted: boolean }
    | undefined

  BashTool.call = (async () => ({
    data: {
      stdout: null,
      stderr: null,
      interrupted: false,
    },
  })) as unknown as typeof BashTool.call

  BashTool.mapToolResultToToolResultBlockParam = (result, toolUseID) => {
    normalizedResult = result as {
      stdout: string
      stderr: string
      interrupted: boolean
    }
    return originalMapToolResultToToolResultBlockParam(result, toolUseID)
  }

  await executeShellCommandsInPrompt(
    '```!\ngit status\n```',
    {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: new Map(),
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: {
          systemDefinitions: [],
          projectDefinitions: [],
          userDefinitions: [],
        },
      },
      readFileState: new Map(),
      getAppState() {
        return {
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysAllowRules: { command: ['Bash(*)'] },
          },
        }
      },
      setAppState() {},
    } as never,
    'security-review',
  )

  expect(normalizedResult).toEqual({
    stdout: '',
    stderr: '',
    interrupted: false,
  })
})

test('executeShellCommandsInPrompt applies per-prefix line limits', async () => {
  BashTool.call = (async () => ({
    data: {
      stdout: 'line1\nline2\nline3\nline4\nline5\n',
      stderr: '',
      interrupted: false,
    },
  })) as unknown as typeof BashTool.call

  BashTool.mapToolResultToToolResultBlockParam = (result, toolUseID) =>
    originalMapToolResultToToolResultBlockParam(
      result as never,
      toolUseID,
    )

  const result = await executeShellCommandsInPrompt(
    '```!\ngit diff HEAD -- .\n```',
    {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: new Map(),
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: {
          systemDefinitions: [],
          projectDefinitions: [],
          userDefinitions: [],
        },
      },
      readFileState: new Map(),
      getAppState() {
        return {
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysAllowRules: { command: ['Bash(*)'] },
          },
        }
      },
      setAppState() {},
    } as never,
    'bughunter',
    undefined,
    { lineLimits: { 'git diff HEAD -- .': 3 } },
  )

  expect(result).toBe('line1\nline2\nline3')
})

test('executeShellCommandsInPrompt does not truncate below the cap', async () => {
  BashTool.call = (async () => ({
    data: {
      stdout: 'line1\nline2\n',
      stderr: '',
      interrupted: false,
    },
  })) as unknown as typeof BashTool.call

  BashTool.mapToolResultToToolResultBlockParam = (result, toolUseID) =>
    originalMapToolResultToToolResultBlockParam(
      result as never,
      toolUseID,
    )

  const result = await executeShellCommandsInPrompt(
    '```!\ngit diff HEAD -- .\n```',
    {
      abortController: new AbortController(),
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'sonnet',
        tools: new Map(),
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: {
          systemDefinitions: [],
          projectDefinitions: [],
          userDefinitions: [],
        },
      },
      readFileState: new Map(),
      getAppState() {
        return {
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysAllowRules: { command: ['Bash(*)'] },
          },
        }
      },
      setAppState() {},
    } as never,
    'bughunter',
    undefined,
    { lineLimits: { 'git diff HEAD -- .': 400 } },
  )

  expect(result).toBe('line1\nline2')
})
