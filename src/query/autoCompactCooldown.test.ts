import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getAutoCompactThreshold,
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
  OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP:
    process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP,
  OPENCLAUDE_MAX_ACTIVE_MESSAGES:
    process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES,
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

function overAutoCompactThresholdMessage(): Message {
  const threshold = getAutoCompactThreshold('claude-sonnet-4')
  return userMessage('x'.repeat((threshold + 1_000) * 4))
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
  const messages = [overAutoCompactThresholdMessage()]
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
  const messages = [overAutoCompactThresholdMessage()]
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

test('persisted breaker state does not block when auto-compact is disabled', async () => {
  process.env.DISABLE_AUTO_COMPACT = '1'
  const initialTracking: AutoCompactTrackingState = {
    compacted: false,
    turnId: 'turn',
    turnCounter: 0,
    consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
    nextRetryAtMs: Date.now() + 60_000,
  }
  const callModel = mock(async function* () {
    yield assistantToolUseMessage()
  })
  const deps = {
    callModel,
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })),
    autocompact: mock(async () => ({
      wasCompacted: false,
    })),
    uuid: () => 'test-uuid',
  } as never

  const { yielded, terminal } = await drain(
    query({
      messages: [overAutoCompactThresholdMessage()],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool,
      toolUseContext: toolUseContext(),
      querySource: 'repl_main_thread',
      maxTurns: 1,
      deps,
      autoCompactTracking: initialTracking,
    }),
  )

  expect(callModel).toHaveBeenCalledTimes(1)
  expect(terminal.reason).toBe('max_turns')
  expect(
    yielded.some(
      message =>
        (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
    ),
  ).toBe(false)
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
      messages: [overAutoCompactThresholdMessage()],
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

// ---------------------------------------------------------------------------
// Issue #1373: when the message-count cap is exceeded, forceReason must
// override the breaker. Without this, a single summarization failure that
// trips the breaker can let state.messages grow without bound until the
// Node heap OOMs.
// ---------------------------------------------------------------------------

test('forced message-count compaction overrides an active cool-down', async () => {
  // Force the hard message-count cap to 1, then provide 2 messages so the
  // `length > cap` check trips on the first turn. (The constant default of
  // 1000 would be fine functionally but a tiny cap keeps the test fast and
  // explicit about intent.)
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  const messages = [
    overAutoCompactThresholdMessage(),
    overAutoCompactThresholdMessage(),
  ]
  const seenTracking: Array<AutoCompactTrackingState | undefined> = []
  const deps = {
    callModel: mock(async function* () {
      yield assistantToolUseMessage()
    }),
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
        // Confirm the breaker was tripped but forceReason was carried in.
        expect(tracking?.consecutiveFailures).toBe(
          MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        )
        expect(tracking?.forceReason).toBe('message-count')
        // Forced path succeeded — return a clean compact result.
        return {
          wasCompacted: true,
          consecutiveFailures: 0,
        }
      },
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
      maxTurns: 1,
      deps,
      autoCompactTracking: {
        compacted: false,
        turnCounter: 0,
        turnId: 'turn',
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs: Date.now() + 60_000,
      },
    }),
  )

  // The call model must have run — no blocking_limit, no api_error. This is
  // the critical assertion: the forced compaction succeeded and the loop
  // continued to the model.
  expect(terminal.reason).toBe('max_turns')
  expect(seenTracking).toHaveLength(1)
  expect(seenTracking[0]?.forceReason).toBe('message-count')
  expect(
    yielded.some(
      message =>
        (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
    ),
  ).toBe(false)
})

// ---------------------------------------------------------------------------
// Regression (CodeRabbit review on PR #1615): when the operator disables
// the hard cap (OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP=0) but the user has
// set their own opt-in cap, the user cap MUST still take effect. Earlier
// `Math.min(userCap, hardCap)` collapsed to 0 in that configuration and
// silently disabled user-configured compaction.
// ---------------------------------------------------------------------------

test('user cap still fires when the operator-level hard cap is disabled', async () => {
  // Operator disables the hard cap; user keeps their own threshold at 5.
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '0'
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES = '5'

  // 6 messages > user cap of 5, so the user cap must trip even though
  // hard cap is disabled.
  const messages = Array.from({ length: 6 }, () =>
    overAutoCompactThresholdMessage(),
  )
  const seenTracking: Array<AutoCompactTrackingState | undefined> = []
  const deps = {
    callModel: mock(async function* () {
      yield assistantToolUseMessage()
    }),
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
        expect(tracking?.forceReason).toBe('message-count')
        return {
          wasCompacted: true,
          consecutiveFailures: 0,
        }
      },
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
      maxTurns: 1,
      deps,
    }),
  )

  expect(terminal.reason).toBe('max_turns')
  expect(seenTracking).toHaveLength(1)
  expect(seenTracking[0]?.forceReason).toBe('message-count')
  expect(
    yielded.some(
      message =>
        (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
    ),
  ).toBe(false)
})

// ---------------------------------------------------------------------------
// Issue #1373 follow-up (jatmn review): a forced message-count compaction
// that fails must respect the breaker cool-down on subsequent over-cap
// turns. Otherwise `state.messages` would re-fire `compactConversation` on
// every turn while a provider is down, which is exactly the retry storm
// the breaker is meant to contain. The cap check gates the re-trigger on
// `lastForcedFailureAtMs` so the safety net is preserved (token-threshold
// trips still bypass), but a recent forced attempt is honored.
// ---------------------------------------------------------------------------

test('hard-cap re-trigger respects a recent forced-failure cool-down', async () => {
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS = '60000'
  // Cooldown covers the seeded lastForcedFailureAtMs so the gate fires.
  const forcedFailureAtMs = Date.now() - 1_000
  const messages = [
    overAutoCompactThresholdMessage(),
    overAutoCompactThresholdMessage(),
  ]
  const autocompact = mock(
    async (
      _messages: never,
      _toolUseContext: never,
      _params: never,
      _querySource: never,
      tracking: AutoCompactTrackingState | undefined,
    ) => {
      // Critical: the cap check must NOT have re-set forceReason, so
      // autoCompactIfNeeded never sees a forced path and never calls
      // compactConversation. The mock returning breaker metadata
      // mirrors autoCompactIfNeeded's real skip behavior.
      expect(tracking?.forceReason).toBeUndefined()
      return {
        wasCompacted: false,
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs: forcedFailureAtMs + 60_000,
        lastFailureAtMs: forcedFailureAtMs,
        circuitBreakerActive: true,
        circuitBreakerTripped: true,
      }
    },
  )
  const deps = {
    callModel: mock(async function* () {
      yield assistantToolUseMessage()
    }),
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })),
    autocompact,
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
      maxTurns: 1,
      deps,
      autoCompactTracking: {
        compacted: false,
        turnCounter: 0,
        turnId: 'turn',
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs: forcedFailureAtMs + 60_000,
        lastForcedFailureAtMs: forcedFailureAtMs,
      },
    }),
  )

  // The messages are over the auto-compact token threshold, so when the
  // cap-re-trigger is suppressed by the cool-down gate, the existing
  // token-threshold blocking safety net (src/query.ts:898-938) catches
  // it and returns blocking_limit with an api_error rather than firing
  // compactConversation. This is the desired behavior: no retry storm
  // and a clear error message instead of repeated forced attempts.
  expect(terminal.reason).toBe('blocking_limit')
  expect(autocompact).toHaveBeenCalledTimes(1)
  const apiError = yielded.find(
    (message): message is Message =>
      (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
  )
  expect(apiError).toBeDefined()
  expect(apiError!.message.content[0].text).toContain('cooling down')
})

test('hard-cap re-trigger fires again once the cool-down has elapsed', async () => {
  // Positive control for the gate above: when lastForcedFailureAtMs is
  // far enough in the past that the cool-down has elapsed, the cap must
  // re-fire. Without this, the gate would permanently lock out the
  // safety net and compaction would never happen again.
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS = '60000'
  const longAgoMs = Date.now() - 10 * 60_000
  const messages = [
    overAutoCompactThresholdMessage(),
    overAutoCompactThresholdMessage(),
  ]
  const seenTracking: Array<AutoCompactTrackingState | undefined> = []
  const deps = {
    callModel: mock(async function* () {
      yield assistantToolUseMessage()
    }),
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
        expect(tracking?.forceReason).toBe('message-count')
        return {
          wasCompacted: true,
          consecutiveFailures: 0,
        }
      },
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
      maxTurns: 1,
      deps,
      autoCompactTracking: {
        compacted: false,
        turnCounter: 0,
        turnId: 'turn',
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs: longAgoMs,
        lastForcedFailureAtMs: longAgoMs,
      },
    }),
  )

  expect(terminal.reason).toBe('max_turns')
  expect(seenTracking).toHaveLength(1)
  expect(seenTracking[0]?.forceReason).toBe('message-count')
  expect(
    yielded.some(
      message =>
        (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
    ),
  ).toBe(false)
})
