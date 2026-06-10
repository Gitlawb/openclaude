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

const TEST_MODEL = 'claude-sonnet-4'

type ConfigModule = typeof import('../utils/config.js')
type QueryModule = typeof import('../query.js')
type AutoCompactModule = typeof import('../services/compact/autoCompact.js')
type SavedEnv = {
  CLAUDE_CONFIG_DIR: string | undefined
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: string | undefined
  DISABLE_AUTO_COMPACT: string | undefined
  DISABLE_COMPACT: string | undefined
}

let savedEnv: SavedEnv | undefined
let savedAutoCompactEnabled: boolean | undefined
let tempDir: string | undefined
let configModule: ConfigModule | undefined
let autoCompactModule: AutoCompactModule | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('query/autoCompactCooldown.test.ts')
  savedEnv = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
    DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT,
    DISABLE_COMPACT: process.env.DISABLE_COMPACT,
  }

  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-autocompact-test-'))
  process.env.CLAUDE_CONFIG_DIR = tempDir
  delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  delete process.env.DISABLE_AUTO_COMPACT
  delete process.env.DISABLE_COMPACT

  const nonce = `${Date.now()}-${Math.random()}`
  const freshConfigModule = await import(`../utils/config.js?test=${nonce}`)
  configModule = freshConfigModule
  mock.module('../utils/config.js', () => freshConfigModule)

  const freshAutoCompactModule = await import(
    `../services/compact/autoCompact.ts?test=${nonce}`
  )
  autoCompactModule = freshAutoCompactModule
  mock.module('../services/compact/autoCompact.js', () => freshAutoCompactModule)
  savedAutoCompactEnabled = configModule.getGlobalConfig().autoCompactEnabled
  configModule.saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: true,
  }))
})

afterEach(() => {
  try {
    if (savedAutoCompactEnabled !== undefined && configModule) {
      const autoCompactEnabled = savedAutoCompactEnabled
      configModule.saveGlobalConfig(current => ({
        ...current,
        autoCompactEnabled,
      }))
      savedAutoCompactEnabled = undefined
    }

    for (const [key, value] of Object.entries(savedEnv ?? {})) {
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
    configModule = undefined
    autoCompactModule = undefined
    savedEnv = undefined
  } finally {
    releaseSharedMutationLock()
  }
})

function userMessage(content: string): Message {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid: `test-${Math.random()}`,
    timestamp: new Date().toISOString(),
  }
}

function overAutoCompactThresholdMessage(): Message {
  const threshold = getAutoCompactModule().getAutoCompactThreshold(TEST_MODEL)
  return userMessage('x'.repeat((threshold + 1_000) * 4))
}

function maxAutoCompactFailures(): number {
  return getAutoCompactModule().MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
}

function getAutoCompactModule(): AutoCompactModule {
  if (!autoCompactModule) {
    throw new Error('autoCompactModule not initialized - call beforeEach first')
  }
  return autoCompactModule
}

async function importQueryUnderTest(): Promise<QueryModule['query']> {
  const nonce = `${Date.now()}-${Math.random()}`
  const module = await import(`../query.ts?test=${nonce}`)
  return module.query
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
      mainLoopModel: TEST_MODEL,
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
      mainLoopModel: TEST_MODEL,
      mainLoopModelForSession: undefined,
      mcp: { tools: [], clients: [] },
      toolPermissionContext: { mode: 'default' },
    }),
    setInProgressToolUseIDs: () => {},
  } as never
}

function assistantToolUseMessage(): Message {
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
    uuid: 'assistant-tool-use',
    timestamp: new Date().toISOString(),
  }
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
  const query = await importQueryUnderTest()
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
        consecutiveFailures: maxAutoCompactFailures(),
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
  const query = await importQueryUnderTest()
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
          consecutiveFailures: maxAutoCompactFailures(),
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
    maxAutoCompactFailures(),
  )
})

test('post-compact turn tracking callback publishes a fresh object', async () => {
  const query = await importQueryUnderTest()
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
  const query = await importQueryUnderTest()
  const initialTracking: AutoCompactTrackingState = {
    compacted: false,
    turnId: 'turn',
    turnCounter: 0,
    consecutiveFailures: maxAutoCompactFailures(),
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
  const query = await importQueryUnderTest()
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
      consecutiveFailures: maxAutoCompactFailures(),
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
    maxAutoCompactFailures(),
  )
  expect(trackingUpdates[0]?.nextRetryAtMs).toBe(20_000)
  expect(trackingUpdates[0]?.lastFailureAtMs).toBe(15_000)
  expect(initialTracking.consecutiveFailures).toBe(2)
  expect(initialTracking.nextRetryAtMs).toBe(10_000)
  expect(initialTracking.lastFailureAtMs).toBe(5_000)
})
