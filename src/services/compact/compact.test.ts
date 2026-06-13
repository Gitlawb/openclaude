import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { randomUUID } from 'crypto'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { Message } from '../../types/message.js'
import * as realConfig from '../../utils/config.js'

// Several earlier test files in the smoke suite call
// mock.module('../../utils/model/providers.js', ...) to stub getAPIProvider.
// bun:test's mock.module() registry is process-global and mock.restore() does
// NOT clear it, so the cached bare-path import of providers.js inside betas.ts
// (which compact.ts transitively imports) resolves to that stub unless we
// override it. We import the real providers module through a cache-busting URL
// and re-register it under the bare specifier at module level.
const _realProvidersModule = await import(
  `../../utils/model/providers.js?real=${Date.now()}-${Math.random()}`
)
mock.module('../../utils/model/providers.js', () => ({
  getAPIProvider: _realProvidersModule.getAPIProvider,
  usesAnthropicAccountFlow: _realProvidersModule.usesAnthropicAccountFlow,
  isGithubNativeAnthropicMode: _realProvidersModule.isGithubNativeAnthropicMode,
  getAPIProviderForStatsig: _realProvidersModule.getAPIProviderForStatsig,
  isFirstPartyAnthropicBaseUrl: _realProvidersModule.isFirstPartyAnthropicBaseUrl,
}))

// Pre-import the real diskOutput module so we can restore it in afterAll
// (compact's mock of getTaskOutputPath leaks and breaks BashTool tests).
const _realDiskOutputModule = await import(
  `../../utils/task/diskOutput.js?real=${Date.now()}-${Math.random()}`
)
// Pre-import real modules that compact stubs but downstream tests need
// (goal continuation controller, runAgent provider routing).
const _realMessagesModule = await import(
  `../../utils/messages.js?real=${Date.now()}-${Math.random()}`
)
const _realBootstrapStateModule = await import(
  `../../bootstrap/state.js?real=${Date.now()}-${Math.random()}`
)
const _realSettingsModule = await import(
  `../../utils/settings/settings.js?real=${Date.now()}-${Math.random()}`
)
const _realModelModule = await import(
  `../../utils/model/model.js?real=${Date.now()}-${Math.random()}`
)
const _realAuthModule = await import(
  `../../utils/auth.js?real=${Date.now()}-${Math.random()}`
)
const _realPathModule = await import(
  `../../utils/path.js?real=${Date.now()}-${Math.random()}`
)
const _realConfigModule = await import(
  `../../utils/config.js?real=${Date.now()}-${Math.random()}`
)
const _realProjectInstructionsModule = await import(
  `../../utils/projectInstructions.js?real=${Date.now()}-${Math.random()}`
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMessage(content: string): Message {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

function assistantMessage(text: string): Message {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      // AssistantMessageContent also requires id, model, usage at the type
      // level; the compact code paths under test don't read them, so cast
      // through unknown to keep the helper focused on the text content.
    } as never,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

function toolUseContext() {
  return {
    agentId: 'test-agent',
    options: {
      mainLoopModel: 'claude-sonnet-4-5',
      tools: [],
      mcpClients: [],
      agentDefinitions: { activeAgents: [] },
    },
    getAppState: mock(() => ({
      toolPermissionContext: {},
      effortValue: undefined,
      tasks: {} as Record<string, unknown>,
    })),
    onCompactProgress: mock(() => {}),
    setStreamMode: mock(() => {}),
    setResponseLength: mock(() => {}),
    setSDKStatus: mock(() => {}),
    abortController: new AbortController(),
    readFileState: new Map(),
  } as never
}

function cacheSafeParams(messages: Message[]) {
  return {
    systemPrompt: [],
    userContext: {},
    systemContext: {},
    toolUseContext: toolUseContext(),
    forkContextMessages: messages,
  } as never
}

// ---------------------------------------------------------------------------
// Env snapshot / restore
// ---------------------------------------------------------------------------

// Provider/profile env vars that can steer provider detection. We do NOT keep
// an "original" snapshot (the snapshot would be polluted by test files that run
// before this one in the smoke suite). Each test starts with a clean slate and
// sets only the vars it explicitly needs.
const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'MINIMAX_API_KEY',
  'XAI_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'NEARAI_API_KEY',
  // See FIREWORKS_API_KEY comment in src/utils/betas.test.ts: a leaked
  // key is interpreted as 'firstParty' by getAPIProvider because the
  // 'fireworks' route has no switch case in that function.
  'FIREWORKS_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'USER_TYPE',
  'CLAUDE_CODE_ENTRYPOINT',
] as const

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key]
  }
}

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/**
 * Options that control the behavior of the compact mock fixture.
 *
 * **Essential mocks** (required for the provider gate test — must be overridable):
 * - `runForkedAgent` — spy target; asserted on in both test cases
 * - `growthBookDefault` — controls the GrowthBook flag that gates cache-sharing
 *
 * **Provider gate control via environment variables:**
 * - The `isAnthropicProvider()` gate is tested by setting provider env vars
 *   (e.g. CLAUDE_CODE_USE_OPENAI=1) instead of mocking betas.ts. This avoids
 *   mock.module() leaks that cause CI failures in other test files.
 *
 * **Defensive stubs** (prevent transitive import/side-effect failures):
 * - Everything else registered by registerCommonCompactStubs is a defensive
 *   stub needed to let compactConversation() run start-to-finish without real
 *   network, GrowthBook, hooks, token counting, or filesystem I/O.
 */
export type CompactMockOptions = {
  /** Mock for runForkedAgent(). ESSENTIAL — spy asserted on by both tests. */
  runForkedAgent?: ReturnType<typeof mock>
  /** GrowthBook default for tengu_compact_cache_prefix. */
  growthBookDefault?: boolean
  /** Mock for executePreCompactHooks. */
  executePreCompactHooks?: ReturnType<typeof mock>
}

/**
 * Register all common (defensive) stubs needed by compactConversation() and
 * streamCompactSummary(). Returns an object with hooks that the caller can
 * inspect or override, most importantly `runForkedAgent`.
 *
 * This is the **shared fixture** — new compact tests should call this instead
 * of copying the ~40 mock.module() calls.  Annotated inline: [ESSENTIAL] marks
 * mocks that the provider gate test specifically depends on; all others are
 * DEFENSIVE (prevent transitive import / side-effect / I/O failures).
 */
function registerCommonCompactStubs(options: CompactMockOptions = {}) {
  mock.restore()

  // --- Provider gate control ---
  // The isAnthropicProvider() gate is exercised via environment variables
  // (e.g. CLAUDE_CODE_USE_OPENAI=1) instead of mock.module() on betas.ts.
  // This avoids mock.module() leaks that cause CI failures in other test
  // files (betas.test.ts, autoCompact.test.ts) that import the real module.
  // The beforeEach hook already calls clearProviderEnv(), so each test
  // starts with a clean provider state and the real betas.ts /
  // providers.ts / envUtils.ts work from env vars.

  // --- Forked agent (ESSENTIAL — spy for call-count assertions) ---
  const runForkedAgent =
    options.runForkedAgent ??
    mock(async () => ({
      messages: [
        assistantMessage('This is a compact summary of the conversation.'),
      ],
      totalUsage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }))
  mock.module('../../utils/forkedAgent.js', () => ({
    runForkedAgent,
  }))

  // --- GrowthBook (DEFENSIVE) ---
  mock.module('../analytics/growthbook.js', () => ({
    getFeatureValue_CACHED_MAY_BE_STALE: mock(
      () => options.growthBookDefault ?? true,
    ),
  }))

  // --- Analytics (DEFENSIVE) ---
  mock.module('../analytics/index.js', () => ({
    logEvent: mock(() => {}),
  }))

  // --- Hooks (DEFENSIVE) ---
  mock.module('../../utils/hooks.js', () => ({
    executePreCompactHooks:
      options.executePreCompactHooks ??
      mock(async () => ({
        newCustomInstructions: null,
        userDisplayMessage: null,
        userMessage: null,
      })),
    executePostCompactHooks: mock(async () => []),
  }))

  // --- Token helpers (DEFENSIVE) ---
  mock.module('../../utils/tokens.js', () => ({
    tokenCountWithEstimation: mock(() => 1000),
    tokenCountFromLastAPIResponse: mock(() => 100),
    getTokenUsage: mock(() => ({
      input_tokens: 100,
      output_tokens: 50,
    })),
  }))

  // --- Token estimation (DEFENSIVE) ---
  mock.module('../tokenEstimation.js', () => ({
    roughTokenCountEstimation: mock(() => 100),
    roughTokenCountEstimationForMessages: mock(() => 500),
  }))

  // --- Message helpers (DEFENSIVE — stub just enough) ---
  mock.module('../../utils/messages.js', () => ({
    createUserMessage: mock(
      (opts: { content: string; isCompactSummary?: boolean }) => ({
        type: 'user' as const,
        message: { role: 'user' as const, content: opts.content },
        uuid: `msg-${Math.random()}`,
        timestamp: new Date().toISOString(),
        isCompactSummary: opts.isCompactSummary ?? false,
      }),
    ),
    createCompactBoundaryMessage: mock(() => ({
      type: 'system' as const,
      message: { role: 'system' as const, content: '' },
      uuid: `sys-${Math.random()}`,
      timestamp: new Date().toISOString(),
    })),
    getAssistantMessageText: mock(
      (msg: Message) =>
        typeof msg.message.content === 'string'
          ? msg.message.content
          : (Array.isArray(msg.message.content) &&
              msg.message.content[0]?.type === 'text')
            ? msg.message.content[0].text
            : '',
    ),
    getLastAssistantMessage: mock(
      (msgs: Message[]) => msgs.findLast(m => m.type === 'assistant') ?? null,
    ),
    getMessagesAfterCompactBoundary: mock((msgs: Message[]) => msgs),
    isCompactBoundaryMessage: mock(() => false),
    normalizeMessagesForAPI: mock((msgs: Message[]) => msgs),
  }))

  // --- API / streaming (DEFENSIVE) ---
  mock.module('../api/claude.js', () => ({
    queryModelWithStreaming: mock(async function* () {
      yield {
        type: 'assistant' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Streamed summary.' }],
        },
        uuid: `stream-${Math.random()}`,
        timestamp: new Date().toISOString(),
      }
    }),
    getMaxOutputTokensForModel: mock(() => 8192),
  }))

  mock.module('../api/errors.js', () => ({
    getPromptTooLongTokenGap: mock(() => undefined),
    PROMPT_TOO_LONG_ERROR_MESSAGE: 'Prompt is too long',
    startsWithApiErrorPrefix: mock(() => false),
  }))

  mock.module('../api/promptCacheBreakDetection.js', () => ({
    notifyCompaction: mock(() => {}),
  }))

  mock.module('../api/withRetry.js', () => ({
    getRetryDelay: mock(() => 0),
  }))

  // --- Session activity (DEFENSIVE) ---
  mock.module('../../utils/sessionActivity.js', () => ({
    isSessionActivityTrackingActive: mock(() => false),
    sendSessionActivitySignal: mock(() => {}),
  }))

  // --- Tool search (DEFENSIVE) ---
  mock.module('../../utils/toolSearch.js', () => ({
    isToolSearchEnabled: mock(async () => false),
    extractDiscoveredToolNames: mock(() => new Set()),
  }))

  // --- Compact prompt (DEFENSIVE) ---
  mock.module('./prompt.js', () => ({
    getCompactPrompt: mock(() => 'Please summarize this conversation.'),
    getCompactUserSummaryMessage: mock(() => 'Conversation summary'),
    getPartialCompactPrompt: mock(() => 'Summarize this part.'),
  }))

  // --- Compact grouping (DEFENSIVE) ---
  mock.module('./grouping.js', () => ({
    groupMessagesByApiRound: mock((msgs: Message[]) => [msgs]),
  }))

  // --- Config (DEFENSIVE) ---
  mock.module('../../utils/config.js', () => ({
    ..._realConfigModule,
    getMemoryPath: mock(() => '/tmp/memory'),
  }))

  // --- File state cache (DEFENSIVE) ---
  mock.module('../../utils/fileStateCache.js', () => ({
    cacheToObject: mock(() => ({})),
  }))

  // --- Session storage (DEFENSIVE) ---
  mock.module('../../utils/sessionStorage.js', () => ({
    getTranscriptPath: mock(() => '/tmp/transcript'),
    reAppendSessionMetadata: mock(() => {}),
  }))

  // --- Session start hooks (DEFENSIVE) ---
  mock.module('../../utils/sessionStart.js', () => ({
    processSessionStartHooks: mock(async () => []),
  }))

  // --- Attachments (DEFENSIVE) ---
  mock.module('../../utils/attachments.js', () => ({
    createAttachmentMessage: mock(() => ({
      type: 'attachment' as const,
      attachment: { type: 'file' as const, path: '/tmp/test' },
      uuid: `att-${Math.random()}`,
      timestamp: new Date().toISOString(),
    })),
    generateFileAttachment: mock(() => ({})),
    getAgentListingDeltaAttachment: mock(() => []),
    getDeferredToolsDeltaAttachment: mock(() => []),
    getMcpInstructionsDeltaAttachment: mock(() => []),
  }))

  // --- Plans (DEFENSIVE) ---
  mock.module('../../utils/plans.js', () => ({
    getPlan: mock(() => null),
    getPlanFilePath: mock(() => '/tmp/plan'),
  }))

  // --- Path (DEFENSIVE) ---
  mock.module('../../utils/path.js', () => ({
    ..._realPathModule,
    expandPath: mock((p: string) => p),
  }))

  // --- Sleep (DEFENSIVE) ---
  mock.module('../../utils/sleep.js', () => ({
    sleep: mock(async () => {}),
  }))

  // --- Logging (DEFENSIVE) ---
  mock.module('../../utils/log.js', () => ({
    logError: mock(() => {}),
  }))

  mock.module('../../utils/debug.js', () => ({
    logForDebugging: mock(() => {}),
  }))

  // --- Slow operations (DEFENSIVE) ---
  mock.module('../../utils/slowOperations.js', () => ({
    jsonStringify: mock(() => '{}'),
  }))

  // --- Bootstrap state (DEFENSIVE) ---
  mock.module('../../bootstrap/state.js', () => ({
    markPostCompaction: mock(() => {}),
    getInvokedSkillsForAgent: mock(() => []),
    getOriginalCwd: mock(() => '/tmp'),
  }))

  // --- Tools (DEFENSIVE) ---
  mock.module('../../tools/FileReadTool/FileReadTool.js', () => ({
    FileReadTool: { name: 'Read', isMcp: false },
  }))

  mock.module('../../tools/FileReadTool/prompt.js', () => ({
    FILE_READ_TOOL_NAME: 'Read',
    FILE_UNCHANGED_STUB: '',
  }))

  mock.module('../../tools/ToolSearchTool/ToolSearchTool.js', () => ({
    ToolSearchTool: { name: 'ToolSearch', isMcp: false },
  }))

  // --- Context (DEFENSIVE) ---
  mock.module('../../utils/context.js', () => ({
    COMPACT_MAX_OUTPUT_TOKENS: 8192,
  }))

  mock.module('../../utils/contextAnalysis.js', () => ({
    analyzeContext: mock(() => ({})),
    tokenStatsToStatsigMetrics: mock(() => ({})),
  }))

  // --- Project instructions (DEFENSIVE) ---
  mock.module('../../utils/projectInstructions.js', () => ({
    getProjectInstructionFilePaths: mock(() => []),
  }))

  // --- Memory types (DEFENSIVE) ---
  mock.module('../../utils/memory/types.js', () => ({
    MEMORY_TYPE_VALUES: [],
  }))

  // --- System prompt type (DEFENSIVE) ---
  mock.module('../../utils/systemPromptType.js', () => ({
    asSystemPrompt: mock((arr: string[]) => arr),
  }))

  // --- Task output (DEFENSIVE) ---
  mock.module('../../utils/task/diskOutput.js', () => ({
    getTaskOutputPath: mock(() => '/tmp/task'),
  }))

  // --- Errors (DEFENSIVE) ---
  mock.module('../../utils/errors.js', () => ({
    hasExactErrorMessage: mock(() => false),
  }))

  // --- Auth (DEFENSIVE) ---
  mock.module('../../utils/auth.js', () => ({
    isClaudeAISubscriber: mock(() => false),
  }))

  // --- Model support overrides (DEFENSIVE) ---
  mock.module('../../utils/model/modelSupportOverrides.js', () => ({
    get3PModelCapabilityOverride: mock(() => undefined),
  }))

  // --- Settings (DEFENSIVE) ---
  mock.module('../../utils/settings/settings.js', () => ({
    ..._realSettingsModule,
    getInitialSettings: mock(() => ({})),
  }))

  // --- Model (DEFENSIVE) ---
  mock.module('../../utils/model/model.js', () => ({
    ..._realModelModule,
    getCanonicalName: mock((m: string) => m),
  }))

  return { runForkedAgent }
}

/**
 * Import the compact module with all transitive dependencies stubbed.
 *
 * **Provider gate control via environment variables:**
 * - The `isAnthropicProvider()` gate is exercised by setting provider env vars
 *   (e.g. CLAUDE_CODE_USE_OPENAI=1) in the test body, rather than via mock
 *   options. The beforeEach hook calls clearProviderEnv() so each test starts
 *   with a clean provider state and the real betas.ts / providers.ts read
 *   live env vars.
 * - `runForkedAgent` — spy target, returned so tests can assert call count
 * - `getFeatureValue_CACHED_MAY_BE_STALE` (growthBookDefault) — controls the
 *   GrowthBook flag that gates cache-sharing alongside isAnthropicProvider()
 *
 * **Defensive stubs (everything else):**
 * - All other mock.module() calls are defensive fall-through stubs that
 *   prevent the compactConversation() → streamCompactSummary() → post-compaction
 *   pipeline from hitting real network, GrowthBook, hooks, token counting,
 *   skill loading, or filesystem I/O.  Without them the import alone would
 *   trigger hundreds of failed transitive resolution steps.
 */
async function importCompact(options: CompactMockOptions = {}) {
  const { runForkedAgent } = registerCommonCompactStubs(options)

  // Dynamic import with cache-busting so each test gets fresh module state
  const nonce = `${Date.now()}-${Math.random()}`
  const mod = await import(`./compact.ts?test=${nonce}`)
  return { ...mod, runForkedAgent }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await acquireSharedMutationLock('services/compact/compact.test.ts')
  clearProviderEnv()
})

afterEach(() => {
  try {
    mock.restore()
    clearProviderEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

// Safety net: scrub provider env vars and restore mocks after all tests in
// this file finish, so nothing leaks into subsequent test files.
afterAll(async () => {
  mock.restore()
  clearProviderEnv()
  // The compact test registers many mock.module() stubs that persist
  // process-wide. Restore the real implementations so downstream test files
  // (goal controller, runAgent routing, BashTool) get correct behaviour.
  mock.module('../../utils/task/diskOutput.js', () => ({
    getTaskOutputDir: _realDiskOutputModule.getTaskOutputDir,
    getTaskOutputPath: _realDiskOutputModule.getTaskOutputPath,
    initTaskOutput: _realDiskOutputModule.initTaskOutput,
    initTaskOutputAsSymlink: _realDiskOutputModule.initTaskOutputAsSymlink,
    appendTaskOutput: _realDiskOutputModule.appendTaskOutput,
    flushTaskOutput: _realDiskOutputModule.flushTaskOutput,
    evictTaskOutput: _realDiskOutputModule.evictTaskOutput,
    getTaskOutputDelta: _realDiskOutputModule.getTaskOutputDelta,
    getTaskOutput: _realDiskOutputModule.getTaskOutput,
    getTaskOutputSize: _realDiskOutputModule.getTaskOutputSize,
    cleanupTaskOutput: _realDiskOutputModule.cleanupTaskOutput,
    _clearOutputsForTest: _realDiskOutputModule._clearOutputsForTest,
    _resetTaskOutputDirForTest: _realDiskOutputModule._resetTaskOutputDirForTest,
    DiskTaskOutput: _realDiskOutputModule.DiskTaskOutput,
    MAX_TASK_OUTPUT_BYTES: _realDiskOutputModule.MAX_TASK_OUTPUT_BYTES,
    MAX_TASK_OUTPUT_BYTES_DISPLAY: _realDiskOutputModule.MAX_TASK_OUTPUT_BYTES_DISPLAY,
  }))
  mock.module('../../utils/messages.js', () => ({ ..._realMessagesModule }))
  mock.module('../../bootstrap/state.js', () => ({ ..._realBootstrapStateModule }))
  mock.module('../../utils/settings/settings.js', () => ({ ..._realSettingsModule }))
  mock.module('../../utils/model/model.js', () => ({ ..._realModelModule }))
  mock.module('../../utils/auth.js', () => ({ ..._realAuthModule }))
  mock.module('../../utils/path.js', () => ({ ..._realPathModule }))
  mock.module('../../utils/config.js', () => ({ ..._realConfigModule }))
  // projectInstructions: the stub above replaces the whole module with only
  // getProjectInstructionFilePaths, so every other export becomes undefined.
  // Downstream CLAUDE.md discovery in runAgent.routing.test.ts then crashes in
  // processMemoryFile(). Restore the full real module shape.
  mock.module('../../utils/projectInstructions.js', () => ({
    ..._realProjectInstructionsModule,
  }))
  // Clean up the stale /tmp/task symlink left by the mock path.
  try {
    const { unlink } = await import('fs/promises')
    await unlink('/tmp/task').catch(() => {})
  } catch {}
})

describe('compactConversation provider gate', () => {
  test('skips forked-agent cache-sharing for non-Anthropic providers', async () => {
    // Simulate a non-Anthropic provider (e.g. OpenAI) via env vars.
    // The real isAnthropicProvider() reads from process.env and returns false.
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    const { compactConversation, runForkedAgent } = await importCompact({})

    const messages = [userMessage('Hello'), assistantMessage('Hi there!')]
    const ctx = toolUseContext()
    const csp = cacheSafeParams(messages)

    await compactConversation(messages, ctx, csp, false)

    expect(runForkedAgent).not.toHaveBeenCalled()
  })

  test('uses forked-agent cache-sharing for Anthropic providers', async () => {
    // All provider env vars are cleared by beforeEach → default firstParty
    // (Anthropic). The real isAnthropicProvider() returns true.
    const { compactConversation, runForkedAgent } = await importCompact({})

    const messages = [userMessage('Hello'), assistantMessage('Hi there!')]
    const ctx = toolUseContext()
    const csp = cacheSafeParams(messages)

    await compactConversation(messages, ctx, csp, false)

    expect(runForkedAgent).toHaveBeenCalled()
  })

  test('uses forked-agent cache-sharing for GitHub Native Anthropic mode', async () => {
    // CLAUDE_CODE_USE_GITHUB=1 with a Claude model resolves to the "github"
    // provider, so isAnthropicProvider() is false — but it routes through the
    // native Anthropic client where prompt caching works, and the beta gate
    // already treats it as Anthropic-capable. Compaction must do the same and
    // keep cache-sharing on, instead of taking the cold-cache path.
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    const { compactConversation, runForkedAgent } = await importCompact({})

    const messages = [userMessage('Hello'), assistantMessage('Hi there!')]
    // toolUseContext() uses a claude-* mainLoopModel, so this is Native
    // Anthropic mode (not a non-Claude GitHub/OpenAI-style model).
    const ctx = toolUseContext()
    const csp = cacheSafeParams(messages)

    await compactConversation(messages, ctx, csp, false)

    expect(runForkedAgent).toHaveBeenCalled()
  })
})
