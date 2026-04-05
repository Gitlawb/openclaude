import { afterEach, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { BashTool } from '../tools/BashTool/BashTool.js'
import { executeShellCommandsInPrompt } from './promptShellExecution.js'

const originalCall = BashTool.call
const originalMapToolResultToToolResultBlockParam =
  BashTool.mapToolResultToToolResultBlockParam

afterEach(() => {
  BashTool.call = originalCall
  BashTool.mapToolResultToToolResultBlockParam =
    originalMapToolResultToToolResultBlockParam
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
