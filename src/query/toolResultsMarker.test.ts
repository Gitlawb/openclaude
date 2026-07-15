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
  // Include a synthetic user message with tool_result content BEFORE
  // the next user message to establish the "shim boundary". The shim injects
  // TOOL_RESULTS_RECEIVED_MARKER when prev.role === 'tool' (i.e. when the
  // message before the user message contains a tool_result). Without this,
  // shimToolResultBoundary is false and marker suppression is skipped.
  const shimBoundaryMessage = {
    type: 'user' as const,
    uuid: 'assistant-shim-boundary',
    timestamp: new Date().toISOString(),
    message: {
      role: 'user' as const,
      content: [
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' },
      ] as { type: string; tool_use_id?: string; content: string }[],
    },
    toolUseResult: { output: 'ok' },
  }

  return {
    messages: [
      shimBoundaryMessage,
      createUserMessage({ content: 'do something' }),
    ],
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
  expect(terminal.reason).toBe('marker_stall_exhausted')
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
  expect(terminal.reason).toBe('marker_stall_exhausted')
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

test('marker text followed by real continuation text is NOT withheld', async () => {
  const callModel: QueryDeps['callModel'] = async function* () {
    yield createAssistantMessage({
      id: 'assistant-1',
      content: [
        { type: 'text', text: `${TOOL_RESULTS_RECEIVED_MARKER}\n\nI have more work to do.` },
      ],
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

  // Marker is present but real continuation text remains, so the message
  // is yielded to the UI (not withheld) and no marker-only stall nudge fires.
  expect(terminal.reason).toBe('completed')
  const assistantMsgs = yielded.filter((item: any) => item.type === 'assistant')
  expect(assistantMsgs.length).toBeGreaterThanOrEqual(1)
  // The text content should include the non-marker portion.
  const textParts = assistantMsgs.flatMap((msg: any) =>
    msg.message?.content
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text) || [],
  )
  expect(textParts.some((t) => t.includes('I have more work to do.'))).toBe(true)
})

test('marker constant matches shim injection', async () => {
  expect(TOOL_RESULTS_RECEIVED_MARKER).toBe('[Tool results received]')
})

test('mid-sentence marker is stripped without corrupting adjacent text (S1)', async () => {
  let modelCalls = 0

  const callModel: QueryDeps['callModel'] = async function* () {
    modelCalls++
    if (modelCalls === 1) {
      yield createAssistantMessage({
        id: `assistant-1`,
        content: [
          {
            type: 'text',
            text: 'Please continue [Tool results received] and finish',
          },
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

  // Marker is embedded mid-sentence, not marker-only — should NOT be withheld.
  // The stripped remaining text has no continuation signal and no tool_use,
  // so the generator completes after a single call.
  expect(terminal.reason).toBe('completed')
  expect(modelCalls).toBe(1)

  // The stripped text should preserve adjacent words: "Please continue  and finish"
  // (double space is ok — the marker consumed its surrounding whitespace but
  // the stripPattern only removes the literal marker itself).
  const assistantMsgs = yielded.filter((item: any) => item.type === 'assistant')
  const textParts = assistantMsgs.flatMap((msg: any) =>
    msg.message?.content
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text) || [],
  )
  // After strip: "Please continue  and finish" — must NOT be "Please continueand finish"
  const cleaned = textParts[0]
  expect(cleaned).toMatch(/continue[\s]+and/)
  expect(cleaned).not.toContain('continueand')
})

test('marker stall exhausted returns distinct reason (S3)', async () => {
  let modelCalls = 0

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
      if (next.done) return next.value
    }
  })()

  expect(modelCalls).toBe(21) // 1 initial + 20 nudges
  expect(terminal.reason).toBe('marker_stall_exhausted')
})
