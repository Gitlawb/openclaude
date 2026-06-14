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
  OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS:
    process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS,
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
  // Cap env vars must be cleared in beforeEach, not just afterEach, so
  // default-path tests start with a known baseline. Otherwise a host
  // env value (or a value left by a prior test that overrode without
  // resetting) can leak into the first test of the suite and weaken
  // the isolation coverage for the cap logic this PR introduces.
  // CodeRabbit round (P3): complete the beforeEach reset to match
  // afterEach's restore.
  delete process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP
  delete process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES
  // Some tests below override this to a 60s window to drive the
  // cap-check cool-down gate; we reset to default so each test starts
  // with a clean cooldown policy and the 60s doesn't leak into
  // unrelated test files.
  delete process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS
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

// ---------------------------------------------------------------------------
// Issue #1373 follow-up (CodeRabbit review on PR #1615): when
// `autoCompactIfNeeded()` returns no `lastForcedFailureAtMs` on a
// non-forced skip, the cap-check cool-down signal in tracking must NOT
// be cleared. Otherwise the next turn loses the gate, the cap
// re-triggers, and we get the original retry-storm behavior back. This
// test seeds the field once and runs multiple query() calls; the
// tracking carried into each subsequent call must keep the field
// (preserved across turns), while a fresh forced-failure timestamp from
// the call site wins over the stale one.
// ---------------------------------------------------------------------------

test('lastForcedFailureAtMs persists across non-forced skip turns', async () => {
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS = '60000'
  const messages = [
    overAutoCompactThresholdMessage(),
    overAutoCompactThresholdMessage(),
  ]
  const forcedFailureAtMs = Date.now() - 1_000

  // First-turn tracking: a recent forced failure with the cap active.
  const seedTracking: AutoCompactTrackingState = {
    compacted: false,
    turnCounter: 0,
    turnId: 'turn',
    consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
    nextRetryAtMs: forcedFailureAtMs + 60_000,
    lastForcedFailureAtMs: forcedFailureAtMs,
  }

  // Every call returns a non-forced skip (no `lastForcedFailureAtMs`).
  // The breaker metadata is the same on every turn so the query loop
  // keeps threading tracking through the nextTracking branch.
  const autocompact = mock(
    async (
      _messages: never,
      _toolUseContext: never,
      _params: never,
      _querySource: never,
      _tracking: AutoCompactTrackingState | undefined,
    ) => {
      // Mirror the real skip: no `lastForcedFailureAtMs` written, but
      // the breaker is still tripped.
      return {
        wasCompacted: false,
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs: forcedFailureAtMs + 60_000,
        lastFailureAtMs: forcedFailureAtMs,
        circuitBreakerActive: true,
        circuitBreakerTripped: true,
        // intentionally NO lastForcedFailureAtMs
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

  // First call: cap gate fires (cool-down active), blocking_limit. The
  // onAutoCompactTrackingChange callback captures what the query loop
  // actually published — this is the only way to observe whether the
  // nextTracking branch preserved the field, since `autoCompactTracking`
  // is treated as a process-local source of truth the loop may overwrite.
  let capturedAfterFirst: AutoCompactTrackingState | undefined
  const first = await drain(
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
      autoCompactTracking: seedTracking,
      onAutoCompactTrackingChange: tracking => {
        if (tracking) {
          capturedAfterFirst = tracking
        }
      },
    }),
  )
  expect(first.terminal.reason).toBe('blocking_limit')
  // The query loop must have published the tracking with the original
  // lastForcedFailureAtMs preserved. If the nextTracking branch had
  // cleared the field on undefined, this would be undefined here.
  expect(capturedAfterFirst?.lastForcedFailureAtMs).toBe(forcedFailureAtMs)
  expect(capturedAfterFirst?.nextRetryAtMs).toBe(forcedFailureAtMs + 60_000)

  // Second call: feed in the captured tracking (NOT the original
  // seedTracking). This is the actual loop persistence path the test
  // exists to cover. If the field had been cleared on the first call,
  // the cap would re-arm and try to force — that's the original
  // retry-storm bug.
  const second = await drain(
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
      autoCompactTracking: capturedAfterFirst,
    }),
  )
  expect(second.terminal.reason).toBe('blocking_limit')
  expect(autocompact).toHaveBeenCalledTimes(2)
})

// ---------------------------------------------------------------------------
// Issue #1373 follow-up (CodeRabbit): the hard message-count cap is a
// runtime safety net, not a user setting. With DISABLE_AUTO_COMPACT=1 the
// user has opted out of token-threshold autocompact, but the over-cap
// forced path must still run — otherwise the OOM safety net is lost for
// the very users who most need it. This test mirrors "forced message-count
// compaction overrides an active cool-down" but with the user-opt-out
// guard active, proving the contract end-to-end at the query-loop layer.
// ---------------------------------------------------------------------------

test('forced message-count compaction runs even with DISABLE_AUTO_COMPACT=1', async () => {
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  process.env.DISABLE_AUTO_COMPACT = '1'
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
        // The query loop must have stamped `forceReason: 'message-count'`
        // even though the user opted out of token-threshold autocompact.
        expect(tracking?.forceReason).toBe('message-count')
        // Mirror the real autoCompactIfNeeded: forced calls bypass
        // `isAutoCompactEnabled()`, so the compact succeeds and the
        // breaker is reset.
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

  // Critical: forced compaction succeeded, the call model ran, and we
  // did NOT bail out with `blocking_limit`. The OOM safety net is
  // preserved even when the user opted out of token-threshold
  // autocompact.
  expect(terminal.reason).toBe('max_turns')
  expect(seenTracking).toHaveLength(1)
  expect(
    yielded.some(
      message =>
        (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
    ),
  ).toBe(false)
})

// ---------------------------------------------------------------------------
// CodeRabbit follow-up: DISABLE_COMPACT is the stricter opt-out (kills
// manual /compact too). It must NOT disable the OOM safety net either —
// the hard cap is a runtime guard, and a user who flipped DISABLE_COMPACT
// did not opt out of OOM prevention. Same end-to-end shape as the
// DISABLE_AUTO_COMPACT case above but with the stricter env var.
// ---------------------------------------------------------------------------

test('forced message-count compaction runs even with DISABLE_COMPACT=1', async () => {
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  process.env.DISABLE_COMPACT = '1'
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
        nextRetryAtMs: Date.now() + 60_000,
      },
    }),
  )

  expect(terminal.reason).toBe('max_turns')
  expect(seenTracking).toHaveLength(1)
  expect(
    yielded.some(
      message =>
        (message as { isApiErrorMessage?: boolean }).isApiErrorMessage === true,
    ),
  ).toBe(false)
})

// ---------------------------------------------------------------------------
// Issue #1373 follow-up (CodeRabbit round 3): the cap-check cool-down gate
// at src/query.ts must hold even when `nextRetryAtMs` is cleared by a
// non-forced skip. A non-forced skip on a tripped breaker (e.g. token-
// threshold path) can return breaker metadata with no `nextRetryAtMs`,
// and the query loop `delete`s it on the next iteration. Without the
// belt-and-suspenders check on `lastForcedFailureAtMs`, the next over-
// cap turn would restamp `forceReason: 'message-count'` while the
// provider is still recovering — recreating the retry storm. This test
// seeds the cap-only branch (short messages, no token-threshold forcing)
// to exercise the path the other #1373 tests don't reach.
// ---------------------------------------------------------------------------

test('hard-cap cool-down holds even when a non-forced skip clears nextRetryAtMs', async () => {
  process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP = '1'
  process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS = '60000'
  // Two short messages — under the token-threshold so shouldAutoCompact
  // would return false on a non-forced turn. Only the hard-cap branch
  // can force compaction.
  const messages = [userMessage('short'), userMessage('also short')]
  // Recent forced failure so the cool-down is active.
  const forcedFailureAtMs = Date.now() - 1_000

  // The cap-check gate must NOT have re-stamped `forceReason: 'message-count'`.
  // If it did, the mock would receive a forced-attempt tracking and the
  // test would not be exercising the non-forced-skip branch.
  const seenTracking: Array<AutoCompactTrackingState | undefined> = []
  const autocompact = mock(
    async (
      _messages: never,
      _toolUseContext: never,
      _params: never,
      _querySource: never,
      tracking: AutoCompactTrackingState | undefined,
    ) => {
      seenTracking.push(tracking)
      // Mirror the real non-forced-skip shape: breaker metadata but no
      // `lastForcedFailureAtMs` (only forced-attempt failures write it)
      // and no `nextRetryAtMs` (this is the bug: a non-forced skip
      // returning undefined for both lets the query loop `delete` the
      // field, but the cap-check gate should still see
      // `lastForcedFailureAtMs` from the input tracking and hold).
      return {
        wasCompacted: false,
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        // No `nextRetryAtMs` returned — the query loop will `delete` it.
        lastFailureAtMs: forcedFailureAtMs,
        circuitBreakerActive: true,
        circuitBreakerTripped: true,
        // No `lastForcedFailureAtMs` — non-forced skip.
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

  const { terminal } = await drain(
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
      // Seed: cap exceeded, recent forced failure, breaker tripped.
      // The cap-check gate must hold — input already has both
      // `lastForcedFailureAtMs` and `nextRetryAtMs`, but the mock will
      // not return `nextRetryAtMs`, so the loop will `delete` it.
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

  // Cool-down held — no `forceReason: 'message-count'` restamped. The
  // mock would have seen it on `tracking?.forceReason` if the gate had
  // returned false. Also: the call model ran (max_turns, not
  // blocking_limit), and the autocompact mock was only hit once.
  expect(terminal.reason).toBe('max_turns')
  expect(seenTracking).toHaveLength(1)
  expect(seenTracking[0]?.forceReason).toBeUndefined()
  // Sanity: the autocompact mock was actually called (the cap-check
  // gate ran and let the call through, just without the forced path).
  expect(autocompact).toHaveBeenCalledTimes(1)
})

// ---------------------------------------------------------------------------
// Issue #1373 follow-up (CodeRabbit round 4): the forced-failure cool-down
// gate at src/query.ts must also hold for the memory-pressure path, not
// just the message-count path. The pressure monitor keeps re-arming
// `compactionRequested` for as long as RSS stays elevated/critical —
// without the gate, a failed forced memory-pressure attempt would re-fire
// on every subsequent turn, recreating the retry storm the breaker is
// supposed to contain.
//
// This test stubs `consumeCompactionRequest` so the pressure request
// fires unconditionally (mirroring the monitor's elevated/critical
// behavior), seeds a recent forced failure, and asserts the second
// query turn's `autocompact` mock saw `tracking?.forceReason ===
// undefined` — the gate held.
// ---------------------------------------------------------------------------

test('memory-pressure cool-down holds even when the pressure request keeps re-arming', async () => {
  process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS = '60000'
  // No hard cap — pressure is the only forced-reason source.
  delete process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP

  // Stub the pressure monitor so the request fires on every turn,
  // mirroring the real monitor's "keep re-arming while elevated" loop.
  // Capture the mock so we can assert it was actually invoked — without
  // this assertion the test could pass even if the query loop never
  // reached the consumeCompactionRequest site, defeating the point of
  // the regression (CodeRabbit round 4 follow-up).
  const consumeCompactionRequest = mock(() => true)
  mock.module('../utils/memoryPressure.js', () => ({
    consumeCompactionRequest,
  }))

  const messages = [userMessage('short'), userMessage('also short')]
  const forcedFailureAtMs = Date.now() - 1_000

  // The cool-down gate must hold — the mock would see
  // `tracking?.forceReason` set if the gate had returned false. (If the
  // first turn's seed tracking has a real `forceReason`, that's the
  // pre-existing input — the mock's expectation is about the gate's
  // output, not the seed.)
  const seenTracking: Array<AutoCompactTrackingState | undefined> = []
  const autocompact = mock(
    async (
      _messages: never,
      _toolUseContext: never,
      _params: never,
      _querySource: never,
      tracking: AutoCompactTrackingState | undefined,
    ) => {
      seenTracking.push(tracking)
      // No input `forceReason` on the second turn — the gate held.
      expect(tracking?.forceReason).toBeUndefined()
      return {
        wasCompacted: false,
        consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        nextRetryAtMs: forcedFailureAtMs + 60_000,
        lastFailureAtMs: forcedFailureAtMs,
        circuitBreakerActive: true,
        circuitBreakerTripped: true,
        // No `lastForcedFailureAtMs` — non-forced skip.
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

  const { terminal } = await drain(
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
      // Seed: breaker tripped with a recent forced failure, no
      // `forceReason` set (consumeCompactionRequest will be called
      // and would stamp it, but the gate must hold).
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

  // Cool-down held — the pressure restamp was suppressed, so the mock
  // saw an unforced tracking. The call model ran (max_turns, not
  // blocking_limit).
  expect(terminal.reason).toBe('max_turns')
  expect(autocompact).toHaveBeenCalledTimes(1)
  // The query loop must have actually consulted the pressure request
  // — otherwise the gate was never exercised and the test would pass
  // even if the consumeCompactionRequest wiring broke. The pressure
  // monitor is consulted once per turn (drain runs maxTurns=1).
  expect(consumeCompactionRequest).toHaveBeenCalledTimes(1)
})
