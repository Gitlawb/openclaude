import { z } from 'zod/v4'
import { expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { query, type QueryParams } from '../query.js'
import type { QueryDeps } from './deps.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../utils/messages.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { TOOL_RESULTS_RECEIVED_MARKER } from '../constants/messages.js'

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name,
    input,
  } as ToolUseBlock
}

function makeQueryParams(
  callModel: QueryDeps['callModel'],
  overrides: Partial<QueryParams> = {},
): QueryParams {
  return {
    messages: [createUserMessage({ content: 'do something' })],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    toolUseContext: {
      abortController: new AbortController(),
      getAppState: () => ({
        fastMode: false,
        mcp: { tools: [], clients: [] },
        toolPermissionContext: { mode: 'default' },
        sessionHooks: new Map(),
        mainLoopModel: 'gpt-4o',
        effortValue: undefined,
        advisorModel: undefined,
      }),
      options: {
        commands: [],
        debug: false,
        thinkingConfig: { type: 'disabled' },
        tools: [
          {
            name: 'AvailableTool',
            description: 'test tool',
            inputSchema: z.object({}),
          },
        ] as unknown as QueryParams['toolUseContext']['options']['tools'],
        verbose: false,
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: { activeAgents: [], allAgents: [] },
        mainLoopModel: 'gpt-4o',
      },
      addNotification: () => {},
      messages: [],
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    } as unknown as QueryParams['toolUseContext'],
    querySource: 'agent:builtin:general-purpose',
    deps: {
      callModel,
      microcompact: async (messages: any) => ({ messages }),
      autocompact: async () => ({
        wasCompacted: false,
        compactionResult: null,
        consecutiveFailures: undefined,
      }),
      uuid: () => '00000000-0000-4000-8000-000000000000',
    } as unknown as QueryDeps,
    ...overrides,
  }
}

test('marker-only response (no tool_use blocks) forces continuation nudge then caps', async () => {
  let modelCalls = 0

  const callModel: QueryDeps['callModel'] = async function* () {
    modelCalls++
    yield createAssistantMessage({
      id: `assistant-${modelCalls}`,
      content: [{ type: 'text', text: TOOL_RESULTS_RECEIVED_MARKER }] as any,
      model: 'test-model',
      stop_reason: 'end_turn',
      role: 'assistant',
    } as any)
  }

  const yielded: any[] = []
  const terminal = await (async () => {
    const params = makeQueryParams(callModel as any)
    params.deps!.callModel = callModel as any
    const generator = query(params)
    while (true) {
      const next = await generator.next()
      if (next.done) return next.value
      yielded.push(next.value)
    }
  })()

  // Marker-only message is stripped and sets markerOnlyStall=true,
  // which forces a continuation nudge. The mock model keeps echoing the
  // marker so the nudge fires up to MAX_CONTINUATION_NUDGES (20) then
  // the cap terminates the loop.
  expect(modelCalls).toBe(21) // 1 initial + 20 nudges
  expect(terminal.reason).toBe('completed')
  // Marker text should have been stripped from yielded messages.
  const markerTexts = yielded.filter(
    item =>
      item.type === 'assistant' &&
      typeof item.message?.content === 'object' &&
      Array.isArray(item.message.content) &&
      item.message.content.some(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          'text' in c &&
          (c as { text: string }).text === TOOL_RESULTS_RECEIVED_MARKER,
      ),
  )
  expect(markerTexts.length).toBe(0)
})

test('marker with tool_use blocks sets needsFollowUp as before', async () => {
  let modelCalls = 0

  const callModel: QueryDeps['callModel'] = async function* () {
    modelCalls++
    // First call: returns a tool_use plus the marker text
    if (modelCalls === 1) {
      yield createAssistantMessage({
        id: `assistant-1`,
        content: [
          { type: 'text', text: TOOL_RESULTS_RECEIVED_MARKER },
          toolUse('tool-1', 'AvailableTool', {}),
        ],
        model: 'test-model',
        stop_reason: 'end_turn',
        role: 'assistant',
      } as any)
    } else {
      yield createAssistantMessage({
        id: `assistant-2`,
        content: [{ type: 'text', text: 'done' }],
        model: 'test-model',
        stop_reason: 'end_turn',
        role: 'assistant',
      } as any)
    }
  }

  const yielded: any[] = []
  const terminal = await (async () => {
    const params = makeQueryParams(callModel as any)
    params.deps!.callModel = callModel as any
    const generator = query(params)
    while (true) {
      const next = await generator.next()
      if (next.done) return next.value
      yielded.push(next.value)
    }
  })()

  expect(modelCalls).toBe(2)
  expect(terminal.reason).toBe('completed')
  // Tool results are yielded as user messages with tool_result content.
  // The second model call includes the tool result in messagesForQuery.
  expect(yielded.some(
    item =>
      item.type === 'user' &&
      Array.isArray(item.message?.content) &&
      item.message.content.some(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          'tool_use_id' in c &&
          (c as { tool_use_id: string }).tool_use_id === 'tool-1',
      ),
  )).toBe(true)
})

test('repeated marker-only responses hit nudge cap', async () => {
  let modelCalls = 0
  const yielded: any[] = []

  const callModel: QueryDeps['callModel'] = async function* () {
    modelCalls++
    yield createAssistantMessage({
      id: `assistant-${modelCalls}`,
      content: [{ type: 'text', text: TOOL_RESULTS_RECEIVED_MARKER }],
      model: 'test-model',
      stop_reason: 'end_turn',
      role: 'assistant',
    } as any)
  }

  const terminal = await (async () => {
    const params = makeQueryParams(callModel as any)
    params.deps!.callModel = callModel as any
    const generator = query(params)
    while (true) {
      const next = await generator.next()
      if (next.done) {
        return next.value
      }
      yielded.push(next.value)
    }
  })()

  // Marker-only text is stripped; markerOnlyStall forces a nudge.
  // Model keeps echoing the marker so it loops up to MAX_CONTINUATION_NUDGES.
  expect(modelCalls).toBe(21) // 1 initial + 20 nudges
  expect(terminal.reason).toBe('completed')
})

test('marker-only then real text completes after one nudge', async () => {
  let modelCalls = 0

  const callModel: QueryDeps['callModel'] = async function* () {
    modelCalls++
    if (modelCalls === 1) {
      // First call: marker-only (self-hosted echo)
      yield createAssistantMessage({
        id: `assistant-1`,
        content: [{ type: 'text', text: TOOL_RESULTS_RECEIVED_MARKER }],
        model: 'test-model',
        stop_reason: 'end_turn',
        role: 'assistant',
      } as any)
    } else {
      // After nudge: model returns real text with no tool_use
      yield createAssistantMessage({
        id: `assistant-2`,
        content: [{ type: 'text', text: 'All done!' }],
        model: 'test-model',
        stop_reason: 'end_turn',
        role: 'assistant',
      } as any)
    }
  }

  const yielded: any[] = []
  const terminal = await (async () => {
    const params = makeQueryParams(callModel as any)
    params.deps!.callModel = callModel as any
    const generator = query(params)
    while (true) {
      const next = await generator.next()
      if (next.done) return next.value
      yielded.push(next.value)
    }
  })()

  // First call is marker-only → stripped + nudge forces another model call.
  // Second call returns real text → no continuation signal → completes.
  expect(modelCalls).toBe(2)
  expect(terminal.reason).toBe('completed')
})

test('marker constant matches shim injection', async () => {
  expect(TOOL_RESULTS_RECEIVED_MARKER).toBe('[Tool results received]')
})
