import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { Message } from '../../types/message.js'
import * as realConfig from '../../utils/config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMessage(content: string): Message {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid: `test-${Math.random()}`,
    timestamp: new Date().toISOString(),
  }
}

function assistantMessage(text: string): Message {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
    uuid: `test-${Math.random()}`,
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
    })),
    onCompactProgress: mock(() => {}),
    setStreamMode: mock(() => {}),
    setResponseLength: mock(() => {}),
    setSDKStatus: mock(() => {}),
    abortController: new AbortController(),
    readFileState: new Map(),
    loadedNestedMemoryPaths: undefined,
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

const SAVED_ENV = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  USER_TYPE: process.env.USER_TYPE,
  CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearProviderEnv(): void {
  for (const key of Object.keys(SAVED_ENV)) {
    delete process.env[key]
  }
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a helper that mocks everything compactConversation + streamCompactSummary
 * touch, so we can exercise the isAnthropicProvider() gate without real network
 * or real GrowthBook / hooks / token counting.
 */
type CompactMockOptions = {
  isAnthropicProvider?: () => boolean
  runForkedAgent?: ReturnType<typeof mock>
  growthBookDefault?: boolean
  executePreCompactHooks?: ReturnType<typeof mock>
}

async function importCompact(options: CompactMockOptions = {}) {
  mock.restore()

  // --- Provider gate (the key dependency under test) ---
  mock.module('../../utils/betas.js', () => ({
    isAnthropicProvider:
      options.isAnthropicProvider ?? mock(() => false),
    // Other exports from betas.ts that compact.ts may import transitively:
    getMergedBetas: mock(() => []),
    isGithubNativeAnthropicMode: mock(() => false),
    modelSupportsInterleavedThinking: mock(() => false),
    modelSupportsContextManagement: mock(() => false),
    modelSupportsStructuredOutputs: mock(() => false),
    getSdkBetas: mock(() => []),
    getAllModelBetas: mock(() => []),
    getModelBetas: mock(() => []),
    getBedrockExtraBodyParamsBetas: mock(() => []),
    clearBetasCaches: mock(() => {}),
    CLAUDE_CODE_20250219_BETA_HEADER: 'claude-code-20250219',
    CLI_INTERNAL_BETA_HEADER: '',
  }))

  // --- Forked agent (spy it so we can assert call count) ---
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

  // --- GrowthBook ---
  mock.module('../analytics/growthbook.js', () => ({
    getFeatureValue_CACHED_MAY_BE_STALE: mock(
      () => options.growthBookDefault ?? true,
    ),
  }))

  // --- Analytics ---
  mock.module('../analytics/index.js', () => ({
    logEvent: mock(() => {}),
  }))

  // --- Hooks ---
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

  // --- Token helpers ---
  mock.module('../../utils/tokens.js', () => ({
    tokenCountWithEstimation: mock(() => 1000),
    tokenCountFromLastAPIResponse: mock(() => 100),
    getTokenUsage: mock(() => ({
      input_tokens: 100,
      output_tokens: 50,
    })),
  }))

  // --- Token estimation ---
  mock.module('../tokenEstimation.js', () => ({
    roughTokenCountEstimation: mock(() => 100),
    roughTokenCountEstimationForMessages: mock(() => 500),
  }))

  // --- Message helpers (keep real behavior for the ones compact.ts calls) ---
  // We stub just what's needed; the rest falls through to real impl.
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

  // --- API / streaming ---
  mock.module('../api/claude.js', () => ({
    queryModelWithStreaming: mock(async function* () {
      // Yield a single assistant message — the streaming path consumes it.
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

  // --- Session activity ---
  mock.module('../../utils/sessionActivity.js', () => ({
    isSessionActivityTrackingActive: mock(() => false),
    sendSessionActivitySignal: mock(() => {}),
  }))

  // --- Tool search ---
  mock.module('../../utils/toolSearch.js', () => ({
    isToolSearchEnabled: mock(async () => false),
    extractDiscoveredToolNames: mock(() => new Set()),
  }))

  // --- Compact prompt ---
  mock.module('./prompt.js', () => ({
    getCompactPrompt: mock(() => 'Please summarize this conversation.'),
    getCompactUserSummaryMessage: mock(() => 'Conversation summary'),
    getPartialCompactPrompt: mock(() => 'Summarize this part.'),
  }))

  // --- Compact grouping ---
  mock.module('./grouping.js', () => ({
    groupMessagesByApiRound: mock((msgs: Message[]) => [msgs]),
  }))

  // --- Config ---
  mock.module('../../utils/config.js', () => ({
    ...realConfig,
    getMemoryPath: mock(() => '/tmp/memory'),
  }))

  // --- File state cache ---
  mock.module('../../utils/fileStateCache.js', () => ({
    cacheToObject: mock(() => ({})),
  }))

  // --- Session storage ---
  mock.module('../../utils/sessionStorage.js', () => ({
    getTranscriptPath: mock(() => '/tmp/transcript'),
    reAppendSessionMetadata: mock(() => {}),
  }))

  // --- Session start hooks ---
  mock.module('../../utils/sessionStart.js', () => ({
    processSessionStartHooks: mock(async () => []),
  }))

  // --- Attachments ---
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

  // --- Plans ---
  mock.module('../../utils/plans.js', () => ({
    getPlan: mock(() => null),
    getPlanFilePath: mock(() => '/tmp/plan'),
  }))

  // --- Path ---
  mock.module('../../utils/path.js', () => ({
    expandPath: mock((p: string) => p),
  }))

  // --- Sleep ---
  mock.module('../../utils/sleep.js', () => ({
    sleep: mock(async () => {}),
  }))

  // --- Logging ---
  mock.module('../../utils/log.js', () => ({
    logError: mock(() => {}),
  }))

  mock.module('../../utils/debug.js', () => ({
    logForDebugging: mock(() => {}),
  }))

  // --- Slow operations ---
  mock.module('../../utils/slowOperations.js', () => ({
    jsonStringify: mock(() => '{}'),
  }))

  // --- Bootstrap state ---
  mock.module('../../bootstrap/state.js', () => ({
    markPostCompaction: mock(() => {}),
    getInvokedSkillsForAgent: mock(() => []),
    getOriginalCwd: mock(() => '/tmp'),
  }))

  // --- Tools ---
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

  // --- Context ---
  mock.module('../../utils/context.js', () => ({
    COMPACT_MAX_OUTPUT_TOKENS: 8192,
  }))

  mock.module('../../utils/contextAnalysis.js', () => ({
    analyzeContext: mock(() => ({})),
    tokenStatsToStatsigMetrics: mock(() => ({})),
  }))

  // --- Project instructions ---
  mock.module('../../utils/projectInstructions.js', () => ({
    getProjectInstructionFilePaths: mock(() => []),
  }))

  // --- Memory types ---
  mock.module('../../utils/memory/types.js', () => ({
    MEMORY_TYPE_VALUES: [],
  }))

  // --- System prompt type ---
  mock.module('../../utils/systemPromptType.js', () => ({
    asSystemPrompt: mock((arr: string[]) => arr),
  }))

  // --- Task output ---
  mock.module('../../utils/task/diskOutput.js', () => ({
    getTaskOutputPath: mock(() => '/tmp/task'),
  }))

  // --- Errors ---
  mock.module('../../utils/errors.js', () => ({
    hasExactErrorMessage: mock(() => false),
  }))

  // --- Model / providers ---
  mock.module('../../utils/model/providers.js', () => ({
    getAPIProvider: mock(() => 'firstParty'),
    isGithubNativeAnthropicMode: mock(() => false),
  }))

  // --- Auth ---
  mock.module('../../utils/auth.js', () => ({
    isClaudeAISubscriber: mock(() => false),
  }))

  // --- Env utils ---
  mock.module('../../utils/envUtils.js', () => ({
    isEnvDefinedFalsy: mock(() => false),
    isEnvTruthy: mock(() => false),
  }))

  // --- Model support overrides ---
  mock.module('../../utils/model/modelSupportOverrides.js', () => ({
    get3PModelCapabilityOverride: mock(() => undefined),
  }))

  // --- Settings ---
  mock.module('../../utils/settings/settings.js', () => ({
    getInitialSettings: mock(() => ({})),
  }))

  // --- Model ---
  mock.module('../../utils/model/model.js', () => ({
    getCanonicalName: mock((m: string) => m),
  }))

  // Dynamic import with cache-busting
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
    restoreEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('compactConversation provider gate', () => {
  test('skips forked-agent cache-sharing for non-Anthropic providers', async () => {
    // When isAnthropicProvider() returns false (e.g. OpenAI), the forked-agent
    // path must NOT be taken; runForkedAgent should never be called.
    const { compactConversation, runForkedAgent } = await importCompact({
      isAnthropicProvider: mock(() => false),
    })

    const messages = [userMessage('Hello'), assistantMessage('Hi there!')]
    const ctx = toolUseContext()
    const csp = cacheSafeParams(messages)

    try {
      await compactConversation(messages, ctx, csp, false)
    } catch {
      // Post-compaction logic may still fail in the test harness, but the
      // gate check happens before those calls. What matters is whether
      // runForkedAgent was invoked.
    }

    expect(runForkedAgent).not.toHaveBeenCalled()
  })

  test('uses forked-agent cache-sharing for Anthropic providers', async () => {
    // When isAnthropicProvider() returns true, the forked-agent path
    // SHOULD be taken (assuming the GrowthBook flag is also true).
    const { compactConversation, runForkedAgent } = await importCompact({
      isAnthropicProvider: mock(() => true),
    })

    const messages = [userMessage('Hello'), assistantMessage('Hi there!')]
    const ctx = toolUseContext()
    const csp = cacheSafeParams(messages)

    try {
      await compactConversation(messages, ctx, csp, false)
    } catch {
      // Post-compaction logic may still fail, but runForkedAgent should
      // have been called by streamCompactSummary.
    }

    expect(runForkedAgent).toHaveBeenCalled()
  })
})
