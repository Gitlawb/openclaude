import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  type AutoCompactTrackingState,
} from '../services/compact/autoCompact.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { Message } from '../types/message.js'
import { query } from '../query.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'

const SAVED_ENV = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW:
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
  DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT,
  DISABLE_COMPACT: process.env.DISABLE_COMPACT,
}
let savedAutoCompactEnabled: boolean | undefined
let tempDir: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('query/autoCompactCooldown.test.ts')
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-autocompact-test-'))
  process.env.CLAUDE_CONFIG_DIR = tempDir
  savedAutoCompactEnabled = getGlobalConfig().autoCompactEnabled
  saveGlobalConfig(current => ({ ...current, autoCompactEnabled: true }))
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '200000'
  process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '1'
  delete process.env.DISABLE_AUTO_COMPACT
  delete process.env.DISABLE_COMPACT
})

afterEach(() => {
  try {
    if (savedAutoCompactEnabled !== undefined) {
      const autoCompactEnabled = savedAutoCompactEnabled
      saveGlobalConfig(current => ({
        ...current,
        autoCompactEnabled,
      }))
      savedAutoCompactEnabled = undefined
    }

    for (const [key, value] of Object.entries(SAVED_ENV)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  } finally {
    releaseSharedMutationLock()
  }
})

function userMessage(content: string): Message {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid: `test-${Math.random()}` as Message['uuid'],
    timestamp: new Date().toISOString(),
  }
}

function highContextMessages(): Message[] {
  return [
    {
      type: 'assistant',
      message: {
        id: 'msg-high-context',
        role: 'assistant',
        content: [{ type: 'text', text: 'previous response' }],
        usage: {
          input_tokens: 170_000,
          output_tokens: 1_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      uuid: `assistant-${Math.random()}` as Message['uuid'],
      timestamp: new Date().toISOString(),
    } as unknown as Message,
    userMessage('continue'),
  ]
}

function toolUseContext() {
  const abortController = new AbortController()
  return {
    abortController,
    agentId: undefined,
    contentReplacementState: undefined,
    options: {
      agentDefinitions: { activeAgents: [] },
      allowedAgentTypes: undefined,
      appendSystemPrompt: undefined,
      isNonInteractiveSession: false,
      mainLoopModel: 'claude-sonnet-4',
      mcpClients: [],
      providerOverride: undefined,
      thinkingConfig: undefined,
      tools: [],
    },
    readFileState: {},
    getAppState: () => ({
      fastMode: false,
      effortValue: undefined,
      advisorModel: undefined,
      mainLoopModel: 'claude-sonnet-4',
      mainLoopModelForSession: undefined,
      mcp: { tools: [], clients: [] },
      toolPermissionContext: { mode: 'default' },
    }),
    setInProgressToolUseIDs: () => {},
  } as never
}

function assistantToolUseMessage(): Message {
  // Minimal fixture (no model/usage) — cast type-side only.
  return {
    type: 'assistant',
    message: {
      id: 'msg-test-tool-use',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool-use-test',
          name: 'MissingTool',
          input: {},
        },
      ],
    },
    uuid: 'assistant-tool-use' as Message['uuid'],
    timestamp: new Date().toISOString(),
  } as unknown as Message
}

async function canUseTool() {
  return { behavior: 'allow' as const }
}

async function drain<T, TReturn>(
  generator: AsyncGenerator<T, TReturn>,
): Promise<{ yielded: T[]; terminal: TReturn }> {
  const yielded: T[] = []
  while (true) {
    const next = await generator.next()
    if (next.done) {
      return { yielded, terminal: next.value }
    }
    yielded.push(next.value)
  }
}

test('active auto-compact cooldown blocks before model call with cooldown guidance', async () => {
  const messages = highContextMessages()
  const nextRetryAtMs = Date.now() + 60_000
  const callModel = mock(() => {
    throw new Error('model should not be called while autocompact cools down')
  })
  const deps = {
    callModel,
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })),
    autocompact: mock(
      async (): Promise<{
        wasCompacted: boolean
        consecutiveFailures: number
        nextRetryAtMs: number
        circuitBreakerActive: boolean
        circuitBreakerTripped: boolean
      }> => ({
        wasCompacted: false,
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs,
        circuitBreakerActive: true,
        circuitBreakerTripped: false,
      }),
    ),
    uuid: () => 'test-uuid',
  } as never

  const { yielded, terminal } = await drain(
    query({
      messages,
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool,
      toolUseContext: toolUseContext(),
      querySource: 'repl_main_thread',
      deps,
    }),
  )

  expect(callModel).not.toHaveBeenCalled()
  expect(terminal.reason).toBe('blocking_limit')

  const apiError = yielded.find(
    (message): message is Message =>
      (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
  )
  expect(apiError).toBeDefined()
  const text = apiError!.message.content[0].text
  expect(text).toContain('automatic compaction is cooling down')
  expect(text).toContain('Retry after')
})

test('auto-compact cooldown tracking is carried into the next query call', async () => {
  const messages = highContextMessages()
  const nextRetryAtMs = Date.now() + 60_000
  const seenTracking: Array<AutoCompactTrackingState | undefined> = []
  const callModel = mock(() => {
    throw new Error('model should not be called while autocompact cools down')
  })
  const deps = {
    callModel,
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })),
    autocompact: mock(
      async (
        _messages: never,
        _toolUseContext: never,
        _params: never,
        _querySource: never,
        tracking: AutoCompactTrackingState | undefined,
      ) => {
        seenTracking.push(tracking)
        return {
          wasCompacted: false,
          consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
          nextRetryAtMs,
          circuitBreakerActive: true,
          circuitBreakerTripped: false,
        }
      },
    ),
    uuid: () => 'test-uuid',
  } as never

  let persistedTracking: AutoCompactTrackingState | undefined
  const queryParams = () => ({
    messages,
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool,
    toolUseContext: toolUseContext(),
    querySource: 'repl_main_thread' as const,
    deps,
    autoCompactTracking: persistedTracking,
    onAutoCompactTrackingChange: (
      tracking: AutoCompactTrackingState | undefined,
    ) => {
      persistedTracking = tracking
    },
  })

  const first = await drain(query(queryParams()))
  expect(first.terminal.reason).toBe('blocking_limit')
  expect(persistedTracking?.nextRetryAtMs).toBe(nextRetryAtMs)

  const second = await drain(query(queryParams()))
  expect(second.terminal.reason).toBe('blocking_limit')
  expect(callModel).not.toHaveBeenCalled()
  expect(seenTracking).toHaveLength(2)
  expect(seenTracking[0]).toBeUndefined()
  expect(seenTracking[1]?.nextRetryAtMs).toBe(nextRetryAtMs)
  expect(seenTracking[1]?.consecutiveFailures).toBe(
    MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  )
})

test('post-compact turn tracking callback publishes a fresh object', async () => {
  const initialTracking: AutoCompactTrackingState = {
    compacted: true,
    turnId: 'compact-turn',
    turnCounter: 0,
    consecutiveFailures: 0,
  }
  const trackingUpdates: AutoCompactTrackingState[] = []
  const deps = {
    callModel: mock(async function* () {
      yield assistantToolUseMessage()
    }),
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })),
    autocompact: mock(async () => ({
      wasCompacted: false,
    })),
    uuid: () => 'test-uuid',
  } as never

  const { terminal } = await drain(
    query({
      messages: [userMessage('hello')],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool,
      toolUseContext: toolUseContext(),
      querySource: 'repl_main_thread',
      maxTurns: 1,
      deps,
      autoCompactTracking: initialTracking,
      onAutoCompactTrackingChange: tracking => {
        if (tracking) {
          trackingUpdates.push(tracking)
        }
      },
    }),
  )

  expect(terminal.reason).toBe('max_turns')
  expect(trackingUpdates).toHaveLength(1)
  expect(trackingUpdates[0]).not.toBe(initialTracking)
  expect(trackingUpdates[0]?.turnCounter).toBe(1)
  expect(initialTracking.turnCounter).toBe(0)
})

test('breaker metadata tracking callback publishes a fresh object', async () => {
  const initialTracking: AutoCompactTrackingState = {
    compacted: false,
    turnId: 'turn',
    turnCounter: 0,
    consecutiveFailures: 2,
    nextRetryAtMs: 10_000,
    lastFailureAtMs: 5_000,
  }
  const trackingUpdates: AutoCompactTrackingState[] = []
  const deps = {
    callModel: mock(() => {
      throw new Error('model should not be called while autocompact cools down')
    }),
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })),
    autocompact: mock(async () => ({
      wasCompacted: false,
      consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
      nextRetryAtMs: 20_000,
      lastFailureAtMs: 15_000,
      circuitBreakerActive: true,
      circuitBreakerTripped: true,
    })),
    uuid: () => 'test-uuid',
  } as never

  const { terminal } = await drain(
    query({
      messages: highContextMessages(),
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool,
      toolUseContext: toolUseContext(),
      querySource: 'repl_main_thread',
      deps,
      autoCompactTracking: initialTracking,
      onAutoCompactTrackingChange: tracking => {
        if (tracking) {
          trackingUpdates.push(tracking)
        }
      },
    }),
  )

  expect(terminal.reason).toBe('blocking_limit')
  expect(trackingUpdates).toHaveLength(1)
  expect(trackingUpdates[0]).not.toBe(initialTracking)
  expect(trackingUpdates[0]?.consecutiveFailures).toBe(
    MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  )
  expect(trackingUpdates[0]?.nextRetryAtMs).toBe(20_000)
  expect(trackingUpdates[0]?.lastFailureAtMs).toBe(15_000)
  expect(initialTracking.consecutiveFailures).toBe(2)
  expect(initialTracking.nextRetryAtMs).toBe(10_000)
  expect(initialTracking.lastFailureAtMs).toBe(5_000)
})
