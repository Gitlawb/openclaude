import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutoCompactTrackingState } from '../services/compact/autoCompact.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { Message } from '../types/message.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import type { MaxMessagesCompactionThreshold } from '../utils/config.js'
import type { QueryDeps } from './deps.js'

type AutocompactArgs = Parameters<QueryDeps['autocompact']>

// Some smoke-suite files mock config globally; bun:test does not unregister
// mock.module() registrations on mock.restore(). Pin this suite to the real
// config before importing query so saved settings are visible to the query loop.
const realConfigModule = (await import(
  `../utils/config.js?autoCompactCooldownReal=${Date.now()}-${Math.random()}`
)) as typeof import('../utils/config.js')
mock.module('../utils/config.js', () => ({ ...realConfigModule }))

const { getGlobalConfig, saveGlobalConfig } = realConfigModule
const {
  getAutoCompactThreshold,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
} = (await import(
  `../services/compact/autoCompact.js?autoCompactCooldownReal=${Date.now()}-${Math.random()}`
)) as typeof import('../services/compact/autoCompact.js')

const SAVED_ENV = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW:
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
  DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT,
  DISABLE_COMPACT: process.env.DISABLE_COMPACT,
  OPENCLAUDE_MAX_ACTIVE_MESSAGES: process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES,
}

let savedGlobalConfig:
  | {
      autoCompactEnabled: boolean
      maxMessagesCompactionThreshold:
        | MaxMessagesCompactionThreshold
        | undefined
    }
  | undefined
let tempDir: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('query/autoCompactCooldown.test.ts')
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-autocompact-test-'))
  process.env.CLAUDE_CONFIG_DIR = tempDir
  const globalConfig = getGlobalConfig()
  savedGlobalConfig = {
    autoCompactEnabled: globalConfig.autoCompactEnabled,
    maxMessagesCompactionThreshold:
      globalConfig.maxMessagesCompactionThreshold,
  }
  saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: true,
    maxMessagesCompactionThreshold: undefined,
  }))
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '200000'
  process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '1'
  delete process.env.DISABLE_AUTO_COMPACT
  delete process.env.DISABLE_COMPACT
  delete process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES
})

afterEach(() => {
  try {
    if (savedGlobalConfig) {
      const { autoCompactEnabled, maxMessagesCompactionThreshold } =
        savedGlobalConfig
      saveGlobalConfig(current => ({
        ...current,
        autoCompactEnabled,
        maxMessagesCompactionThreshold,
      }))
      savedGlobalConfig = undefined
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

async function loadQuery() {
  return (await import(
    `../query.js?autoCompactCooldown=${Date.now()}-${Math.random()}`
  )) as typeof import('../query.js')
}

function successfulQueryDeps(
  microcompactImpl?: (input: Message[]) => Promise<{ messages: Message[] }>,
) {
  const callModel = mock(async function* (_params: { messages: Message[] }) {
    yield assistantToolUseMessage()
  })
  const microcompact = mock(
    microcompactImpl ?? (async (input: Message[]) => ({ messages: input })),
  )
  const autocompact = mock(async () => ({
    wasCompacted: false,
  }))
  const deps: QueryDeps = {
    callModel: callModel as QueryDeps['callModel'],
    microcompact: microcompact as QueryDeps['microcompact'],
    autocompact: autocompact as QueryDeps['autocompact'],
    uuid: () => 'test-uuid',
  }
  return {
    deps,
    callModel,
    microcompact,
    autocompact,
  }
}

async function runSuccessfulQuery(
  deps: QueryDeps,
  querySource: 'repl_main_thread' | 'compact' = 'repl_main_thread',
) {
  const { query } = await loadQuery()
  return await drain(
    query({
      messages: [userMessage('hello')],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool,
      toolUseContext: toolUseContext(),
      querySource,
      maxTurns: 1,
      deps,
    }),
  )
}

test('explicit off skips automatic microcompact during query flow', async () => {
  saveGlobalConfig(current => ({
    ...current,
    maxMessagesCompactionThreshold: 'off',
  }))
  const { deps, callModel, microcompact, autocompact } = successfulQueryDeps(
    async input => ({ messages: input }),
  )

  const { terminal } = await runSuccessfulQuery(deps)

  expect(terminal.reason).toBe('max_turns')
  expect(callModel).toHaveBeenCalledTimes(1)
  expect(autocompact).toHaveBeenCalledTimes(1)
  expect(microcompact).not.toHaveBeenCalled()
})

test('unset message-count threshold keeps automatic microcompact behavior', async () => {
  const { deps, microcompact } = successfulQueryDeps()

  const { terminal } = await runSuccessfulQuery(deps)

  expect(terminal.reason).toBe('max_turns')
  expect(microcompact).toHaveBeenCalledTimes(1)
})

test('automatic microcompact passes compacted messages to the model call', async () => {
  const compactedMessages = [userMessage('compacted hello')]
  const { deps, callModel, microcompact } = successfulQueryDeps(async () => ({
    messages: compactedMessages,
  }))

  const { terminal } = await runSuccessfulQuery(deps)

  expect(terminal.reason).toBe('max_turns')
  expect(microcompact).toHaveBeenCalledTimes(1)
  expect(callModel.mock.calls[0]?.[0].messages).toEqual(compactedMessages)
})

test('numeric message-count threshold keeps automatic microcompact behavior', async () => {
  saveGlobalConfig(current => ({
    ...current,
    maxMessagesCompactionThreshold: '100',
  }))
  const { deps, microcompact } = successfulQueryDeps()

  const { terminal } = await runSuccessfulQuery(deps)

  expect(terminal.reason).toBe('max_turns')
  expect(microcompact).toHaveBeenCalledTimes(1)
})

test('explicit compact query source still runs microcompact when threshold is off', async () => {
  saveGlobalConfig(current => ({
    ...current,
    maxMessagesCompactionThreshold: 'off',
  }))
  const { deps, microcompact } = successfulQueryDeps()

  const { terminal } = await runSuccessfulQuery(deps, 'compact')

  expect(terminal.reason).toBe('max_turns')
  expect(microcompact).toHaveBeenCalledTimes(1)
})

test('active auto-compact cooldown blocks before model call with cooldown guidance', async () => {
  const messages = [overAutoCompactThresholdMessage()]
  const nextRetryAtMs = Date.now() + 60_000
  const callModel = mock(() => {
    throw new Error('model should not be called while autocompact cools down')
  })
  const deps: QueryDeps = {
    callModel: callModel as QueryDeps['callModel'],
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })) as QueryDeps['microcompact'],
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
    ) as QueryDeps['autocompact'],
    uuid: () => 'test-uuid',
  }

  const { query } = await loadQuery()
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
  const deps: QueryDeps = {
    callModel: callModel as QueryDeps['callModel'],
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })) as QueryDeps['microcompact'],
    autocompact: mock(
      async (
        _messages: AutocompactArgs[0],
        _toolUseContext: AutocompactArgs[1],
        _params: AutocompactArgs[2],
        _querySource: AutocompactArgs[3],
        tracking: AutocompactArgs[4],
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
    ) as QueryDeps['autocompact'],
    uuid: () => 'test-uuid',
  }

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

  const { query } = await loadQuery()
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
  const deps: QueryDeps = {
    callModel: mock(async function* () {
      yield assistantToolUseMessage()
    }) as QueryDeps['callModel'],
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })) as QueryDeps['microcompact'],
    autocompact: mock(async () => ({
      wasCompacted: false,
    })) as QueryDeps['autocompact'],
    uuid: () => 'test-uuid',
  }

  const { query } = await loadQuery()
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
  const deps: QueryDeps = {
    callModel: callModel as QueryDeps['callModel'],
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })) as QueryDeps['microcompact'],
    autocompact: mock(async () => ({
      wasCompacted: false,
    })) as QueryDeps['autocompact'],
    uuid: () => 'test-uuid',
  }

  const { query } = await loadQuery()
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
  const deps: QueryDeps = {
    callModel: mock(() => {
      throw new Error('model should not be called while autocompact cools down')
    }) as QueryDeps['callModel'],
    microcompact: mock(async (input: Message[]) => ({
      messages: input,
    })) as QueryDeps['microcompact'],
    autocompact: mock(async () => ({
      wasCompacted: false,
      consecutiveFailures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
      nextRetryAtMs: 20_000,
      lastFailureAtMs: 15_000,
      circuitBreakerActive: true,
      circuitBreakerTripped: true,
    })) as QueryDeps['autocompact'],
    uuid: () => 'test-uuid',
  }

  const { query } = await loadQuery()
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
