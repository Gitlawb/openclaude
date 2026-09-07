import { expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { createAssistantMessage } from '../../utils/messages.js'
import {
  createAgentExecutionBudgetState,
  createBudgetedCanUseTool,
} from '../../query/agentExecutionBudget.js'
import { StreamingToolExecutor } from './StreamingToolExecutor.js'
import { runTools } from './toolOrchestration.js'

function createTool(
  name: string,
  outcome: 'success' | 'error',
  onCall: () => void = () => {},
): Tool {
  return {
    name,
    inputSchema: z.object({}),
    maxResultSizeChars: 0,
    async call() {
      onCall()
      if (outcome === 'error') {
        throw new Error(`${name} failed`)
      }
      return { data: `${name} complete` }
    },
    async description() {
      return name
    },
    async prompt() {
      return ''
    },
    isConcurrencySafe() {
      return true
    },
    isEnabled() {
      return true
    },
    isReadOnly() {
      return true
    },
    async checkPermissions(input) {
      return { behavior: 'allow', updatedInput: input }
    },
    toAutoClassifierInput() {
      return ''
    },
    userFacingName() {
      return name
    },
    mapToolResultToToolResultBlockParam(content, toolUseId) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: typeof content === 'string' ? content : '',
      }
    },
    renderToolUseMessage() {
      return null
    },
  } as Tool
}

function createContext(tools: Tool[]): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'gpt-5.4-codex',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { agents: [], errors: [] },
      querySource: 'repl_main_thread',
    },
    abortController: new AbortController(),
    messages: [],
    readFileState: {},
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
      sessionHooks: new Map(),
    }),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

function collectToolResults(messages: Message[]) {
  return messages.flatMap(message => {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      return []
    }
    return message.message.content.flatMap(block =>
      block.type === 'tool_result'
        ? [{ id: block.tool_use_id, isError: block.is_error === true }]
        : [],
    )
  })
}

test('parallel tools produce one terminal result each when one tool fails', async () => {
  const successTool = createTool('ParallelSuccess', 'success')
  const errorTool = createTool('ParallelError', 'error')
  const context = createContext([successTool, errorTool])
  const executor = new StreamingToolExecutor(
    [successTool, errorTool],
    (async () => ({ behavior: 'allow' })) as CanUseToolFn,
    context,
  )
  const assistant = createAssistantMessage({
    content: 'run parallel tools',
  }) as AssistantMessage

  executor.addTool(
    {
      type: 'tool_use',
      id: 'call_success',
      name: successTool.name,
      input: {},
    } as ToolUseBlock,
    assistant,
  )
  executor.addTool(
    {
      type: 'tool_use',
      id: 'call_error',
      name: errorTool.name,
      input: {},
    } as ToolUseBlock,
    assistant,
  )

  const messages: Message[] = []
  for await (const update of executor.getRemainingResults()) {
    if (update.message) messages.push(update.message)
  }

  const results = collectToolResults(messages)
  expect(results).toHaveLength(2)
  expect(results).toEqual(
    expect.arrayContaining([
      { id: 'call_success', isError: false },
      { id: 'call_error', isError: true },
    ]),
  )
})

test('unprefixed MCP prefixes are never executed in streaming or collected paths', async () => {
  let executed = 0
  const mcpTool = Object.assign(
    createTool('send', 'success', () => executed++),
    {
      isMcp: true,
      mcpInfo: { serverName: 'mail', toolName: 'send' },
    },
  )
  const context = createContext([mcpTool])
  const canUseTool = (async () => ({
    behavior: 'allow',
  })) as CanUseToolFn
  const truncatedBlock = {
    type: 'tool_use',
    id: 'call_mcp_prefix',
    name: 'sen',
    input: {},
  } as ToolUseBlock
  const assistant = createAssistantMessage({
    content: [truncatedBlock] as never,
  }) as AssistantMessage

  const executor = new StreamingToolExecutor([mcpTool], canUseTool, context)
  executor.addTool(truncatedBlock, assistant)
  const streamingMessages: Message[] = []
  for await (const update of executor.getRemainingResults()) {
    if (update.message) streamingMessages.push(update.message)
  }
  expect(collectToolResults(streamingMessages)).toEqual([
    { id: 'call_mcp_prefix', isError: true },
  ])

  const collectedMessages: Message[] = []
  for await (const update of runTools(
    [truncatedBlock],
    [assistant],
    canUseTool,
    context,
  )) {
    if (update.message) collectedMessages.push(update.message)
  }
  expect(collectToolResults(collectedMessages)).toEqual([
    { id: 'call_mcp_prefix', isError: true },
  ])
  expect(executed).toBe(0)
})

function createBudgetedPermission(maxToolCalls: number) {
  const state = createAgentExecutionBudgetState({
    maxToolCalls,
    softTimeoutMs: 1_000,
    hardTimeoutMs: 2_000,
    reserveFinalTurn: true,
  })
  const allow = (async (_tool, input) => ({
    behavior: 'allow',
    updatedInput: input,
  })) as CanUseToolFn
  return { state, canUseTool: createBudgetedCanUseTool(allow, state) }
}

test('streaming budget rejection keeps one terminal result per tool call', async () => {
  let executed = 0
  const tool = createTool('BudgetedRead', 'success', () => executed++)
  const context = createContext([tool])
  const { state, canUseTool } = createBudgetedPermission(1)
  const executor = new StreamingToolExecutor([tool], canUseTool, context)
  const blocks = ['call-1', 'call-2'].map(
    id =>
      ({ type: 'tool_use', id, name: tool.name, input: {} }) as ToolUseBlock,
  )
  const assistant = createAssistantMessage({
    content: blocks as never,
  }) as AssistantMessage

  for (const block of blocks) executor.addTool(block, assistant)

  const messages: Message[] = []
  for await (const update of executor.getRemainingResults()) {
    if (update.message) messages.push(update.message)
  }

  const results = collectToolResults(messages)
  expect(results).toHaveLength(2)
  expect(results).toEqual(
    expect.arrayContaining([
      { id: 'call-1', isError: false },
      { id: 'call-2', isError: true },
    ]),
  )
  expect(executed).toBe(1)
  expect(state.completionReason).toBe('max_tool_calls')
})

test('non-streaming budget rejection keeps one terminal result per tool call', async () => {
  let executed = 0
  const tool = createTool('BudgetedRead', 'success', () => executed++)
  const context = createContext([tool])
  const { state, canUseTool } = createBudgetedPermission(1)
  const blocks = ['call-1', 'call-2'].map(
    id =>
      ({ type: 'tool_use', id, name: tool.name, input: {} }) as ToolUseBlock,
  )
  const assistant = createAssistantMessage({
    content: blocks as never,
  }) as AssistantMessage

  const messages: Message[] = []
  for await (const update of runTools(
    blocks,
    [assistant],
    canUseTool,
    context,
  )) {
    if (update.message) messages.push(update.message)
  }

  const results = collectToolResults(messages)
  expect(results).toHaveLength(2)
  expect(results).toEqual(
    expect.arrayContaining([
      { id: 'call-1', isError: false },
      { id: 'call-2', isError: true },
    ]),
  )
  expect(executed).toBe(1)
  expect(state.completionReason).toBe('max_tool_calls')
})

test('user cancellation releases a stuck tool, cancels queued tools, and ignores late results', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const stuck = createTool('stuck', 'success')
  stuck.isConcurrencySafe = () => false
  stuck.call = async () => {
    started()
    await blocked // Deliberately ignores AbortSignal, like an unresponsive transport.
    return { data: 'late result' }
  }
  let queuedCalls = 0
  const queued = createTool('queued', 'success', () => queuedCalls++)
  const context = createContext([stuck, queued])
  const executor = new StreamingToolExecutor([stuck, queued],
    (async () => ({ behavior: 'allow' })) as CanUseToolFn, context)
  const assistant = createAssistantMessage({ content: 'run tools' })
  executor.addTool({ type: 'tool_use', id: 'stuck', name: stuck.name, input: {} } as ToolUseBlock, assistant)
  executor.addTool({ type: 'tool_use', id: 'queued', name: queued.name, input: {} } as ToolUseBlock, assistant)
  const messages: Message[] = []
  const collecting = (async () => {
    for await (const update of executor.getRemainingResults()) {
      if (update.message) messages.push(update.message)
    }
  })()
  await entered
  context.abortController.abort('user-cancel')
  await collecting
  expect(queuedCalls).toBe(0)
  expect(collectToolResults(messages)).toEqual([
    { id: 'stuck', isError: true }, { id: 'queued', isError: true },
  ])
  release()
  await Bun.sleep(10)
  expect([...executor.getCompletedResults()]).toEqual([])
  expect(queuedCalls).toBe(0)
})
