import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod/v4'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  buildTool,
  type Tool,
  type ToolUseContext,
  type Tools,
} from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { createToolQueryLeaseInput } from './queryActivityLease.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

const ORIGINAL_BASH_DEFAULT_TIMEOUT_MS = process.env.BASH_DEFAULT_TIMEOUT_MS
const ORIGINAL_BASH_MAX_TIMEOUT_MS = process.env.BASH_MAX_TIMEOUT_MS
const shellInputSchema = z.object({
  command: z.string(),
  timeout: z.number().optional(),
  run_in_background: z.boolean().optional(),
})
type ShellInputSchema = typeof shellInputSchema
type FakeShellTool = Tool<ShellInputSchema, string>

function setShellTimeoutEnv(defaultTimeoutMs = '180000', maxTimeoutMs = '600000') {
  process.env.BASH_DEFAULT_TIMEOUT_MS = defaultTimeoutMs
  process.env.BASH_MAX_TIMEOUT_MS = maxTimeoutMs
}

function createPowerShellTool(call: FakeShellTool['call']): FakeShellTool {
  return buildTool({
    name: POWERSHELL_TOOL_NAME,
    inputSchema: shellInputSchema,
    maxResultSizeChars: Infinity,
    async description() {
      return 'Run a PowerShell command'
    },
    async prompt() {
      return ''
    },
    call,
    mapToolResultToToolResultBlockParam(content, toolUseID) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content,
      }
    },
    renderToolUseMessage() {
      return null
    },
    renderToolResultMessage() {
      return null
    },
  })
}

function createQueryActivityHarness() {
  const release = vi.fn()
  const acquireLease = vi.fn(
    (input: Parameters<NonNullable<ToolUseContext['queryActivity']>['acquireLease']>[0]) => ({
      id: `lease:${input.owner}:${input.id}`,
      release,
    }),
  )
  const registerActivity = vi.fn((_reason: string) => {})

  return {
    queryActivity: {
      acquireLease,
      registerActivity,
    },
    acquireLease,
    registerActivity,
    release,
  }
}

function createToolUseContext(
  tools: Tools,
  queryActivity: NonNullable<ToolUseContext['queryActivity']>,
): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      fastMode: false,
      mcp: { tools: {}, clients: [] },
      sessionHooks: new Map(),
      settings: {},
      toolPermissionContext: { mode: 'default' },
    }),
    setAppState: () => {},
    options: {
      commands: [],
      debug: false,
      thinkingConfig: { type: 'disabled' },
      tools,
      verbose: false,
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allowedAgentTypes: undefined },
      mainLoopModel: 'gpt-4o',
    },
    messages: [],
    queryActivity,
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

async function runFakeToolUse(
  tool: FakeShellTool,
  queryActivity: NonNullable<ToolUseContext['queryActivity']>,
) {
  const toolUse = {
    type: 'tool_use',
    id: 'toolu_lifecycle',
    name: POWERSHELL_TOOL_NAME,
    input: {
      command: 'npm test',
      timeout: 120_000,
    },
  } as ToolUseBlock
  const context = createToolUseContext([tool], queryActivity)
  const assistantMessage = createAssistantMessage({ content: 'run tool' })
  const canUseTool: CanUseToolFn = async (_tool, input) => ({
    behavior: 'allow',
    updatedInput: input,
  })
  const updates: MessageUpdateLazy[] = []

  for await (const update of runToolUse(
    toolUse,
    assistantMessage,
    canUseTool,
    context,
  )) {
    updates.push(update)
  }

  return updates
}

describe('query activity leases for tools', () => {
  afterEach(() => {
    vi.restoreAllMocks()

    if (ORIGINAL_BASH_DEFAULT_TIMEOUT_MS === undefined) {
      delete process.env.BASH_DEFAULT_TIMEOUT_MS
    } else {
      process.env.BASH_DEFAULT_TIMEOUT_MS = ORIGINAL_BASH_DEFAULT_TIMEOUT_MS
    }

    if (ORIGINAL_BASH_MAX_TIMEOUT_MS === undefined) {
      delete process.env.BASH_MAX_TIMEOUT_MS
    } else {
      process.env.BASH_MAX_TIMEOUT_MS = ORIGINAL_BASH_MAX_TIMEOUT_MS
    }
  })

  test('foreground Bash with explicit timeout gets a bounded lease', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_1', {
      command: 'bun test',
      timeout: 600_000,
      run_in_background: false,
    })

    expect(leaseInput).toEqual({
      owner: 'bash',
      id: 'toolu_1',
      timeoutMs: 600_000,
      description: BASH_TOOL_NAME,
    })
  })

  test('foreground PowerShell with explicit timeout gets a bounded lease', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(POWERSHELL_TOOL_NAME, 'toolu_ps', {
      command: 'npm test',
      timeout: 120_000,
    })

    expect(leaseInput).toEqual({
      owner: 'powershell',
      id: 'toolu_ps',
      timeoutMs: 120_000,
      description: POWERSHELL_TOOL_NAME,
    })
  })

  test('foreground Bash without explicit timeout uses the safe default timeout', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_2', {
      command: 'bun run build',
    })

    expect(leaseInput).toEqual({
      owner: 'bash',
      id: 'toolu_2',
      timeoutMs: 180_000,
      description: BASH_TOOL_NAME,
    })
  })

  test('foreground Bash explicit timeout is clamped to the configured maximum', () => {
    setShellTimeoutEnv('120000', '300000')

    const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_clamped', {
      command: 'bun run slow-check',
      timeout: 900_000,
    })

    expect(leaseInput).toEqual({
      owner: 'bash',
      id: 'toolu_clamped',
      timeoutMs: 300_000,
      description: BASH_TOOL_NAME,
    })
  })

  test('foreground Bash invalid timeout values fall back to the safe default', () => {
    setShellTimeoutEnv('150000', '600000')

    for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '60000']) {
      const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, `toolu_${String(timeout)}`, {
        command: 'bun test',
        timeout,
      })

      expect(leaseInput).toEqual({
        owner: 'bash',
        id: `toolu_${String(timeout)}`,
        timeoutMs: 150_000,
        description: BASH_TOOL_NAME,
      })
    }
  })

  test('explicit background shell commands skip foreground query leases', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(POWERSHELL_TOOL_NAME, 'toolu_3', {
      command: 'Start-Sleep -Seconds 60',
      run_in_background: true,
    })

    expect(leaseInput).toBeNull()
  })

  test('non-shell tools skip query leases', () => {
    const leaseInput = createToolQueryLeaseInput('Read', 'toolu_4', {
      file_path: 'README.md',
    })

    expect(leaseInput).toBeNull()
  })

  test('non-record tool inputs skip query leases', () => {
    expect(createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_array', [])).toBeNull()
    expect(createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_null', null)).toBeNull()
  })

  test('successful shell tool execution reports the full query activity lease lifecycle', async () => {
    setShellTimeoutEnv()
    const harness = createQueryActivityHarness()
    const tool = createPowerShellTool(vi.fn(async (
      _input,
      _context,
      _canUseTool,
      _parentMessage,
      onProgress,
    ) => {
      onProgress?.({
        toolUseID: 'toolu_lifecycle',
        data: { type: 'powershell_progress', text: 'running' },
      })

      return { data: 'ok' }
    }))

    const updates = await runFakeToolUse(tool, harness.queryActivity)

    expect(updates.length).toBeGreaterThan(0)
    expect(harness.acquireLease).toHaveBeenCalledTimes(1)
    expect(harness.acquireLease).toHaveBeenCalledWith({
      owner: 'powershell',
      id: 'toolu_lifecycle',
      timeoutMs: 120_000,
      description: POWERSHELL_TOOL_NAME,
    })
    expect(harness.registerActivity.mock.calls.map(([reason]) => reason)).toEqual([
      `tool:${POWERSHELL_TOOL_NAME}:start`,
      `tool:${POWERSHELL_TOOL_NAME}:progress`,
      `tool:${POWERSHELL_TOOL_NAME}:end`,
    ])
    expect(harness.release).toHaveBeenCalledTimes(1)
    expect(harness.release.mock.invocationCallOrder[0]).toBeLessThan(
      harness.registerActivity.mock.invocationCallOrder[2],
    )
  })

  test('thrown shell tool execution still releases the query activity lease', async () => {
    setShellTimeoutEnv()
    const harness = createQueryActivityHarness()
    const tool = createPowerShellTool(vi.fn(async () => {
      throw new Error('tool exploded')
    }))

    const updates = await runFakeToolUse(tool, harness.queryActivity)

    expect(updates.length).toBeGreaterThan(0)
    expect(harness.acquireLease).toHaveBeenCalledTimes(1)
    expect(harness.registerActivity.mock.calls.map(([reason]) => reason)).toEqual([
      `tool:${POWERSHELL_TOOL_NAME}:start`,
      `tool:${POWERSHELL_TOOL_NAME}:end`,
    ])
    expect(harness.release).toHaveBeenCalledTimes(1)
    expect(harness.release.mock.invocationCallOrder[0]).toBeLessThan(
      harness.registerActivity.mock.invocationCallOrder[1],
    )
  })
})
