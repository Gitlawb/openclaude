import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

/**
 * Scheduler-boundary regression test for the GitHub Copilot Premium
 * Request optimization feature (#1534).
 *
 * The PR makes `AgentTool.isConcurrencySafe()` depend on
 * `shouldForceSyncSubagentsInCopilotMode()` so the StreamingToolExecutor
 * and tool orchestrator serialize Agent tool-use blocks under the same
 * Copilot flags that the launch path uses. A future reorder of the
 * helpers, or a divergence between the launch and scheduling policies,
 * would silently allow parallel Copilot sub-agent launches when the
 * user asked for sync (or over-serialize the ALLOW_SUBAGENTS opt-out).
 *
 * This test pins the contract at the boundary: for each Copilot flag
 * combination, the AgentTool's `isConcurrencySafe()` return value
 * matches the expected alignment with the launch path. A change to
 * either side that breaks the alignment fails this test.
 *
 * The AgentTool module body is large (1.4k+ lines, many transitive
 * imports). We import it once via cache-busting and call
 * `isConcurrencySafe()` directly. The relationship is what the bot
 * is asking to lock, and verifying the relationship doesn't require
 * driving the full scheduler.
 */

import * as providers from '../../utils/model/providers.js'
import { _test as orchestrationTest } from '../../services/tools/toolOrchestration.js'
import type { ToolUseContext } from '../../Tool.js'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'

type AgentToolModule = typeof import('./AgentTool.js')
type AgentToolInstance = AgentToolModule['AgentTool']

let AgentTool: AgentToolInstance | undefined
let getAPIProviderSpy:
  | ReturnType<typeof spyOn<typeof providers, 'getAPIProvider'>>
  | undefined

const ORIGINAL_COPILOT_ENV: Record<string, string | undefined> = {
  GITHUB_COPILOT_MAX_SUBAGENTS: process.env.GITHUB_COPILOT_MAX_SUBAGENTS,
  GITHUB_COPILOT_ALLOW_SUBAGENTS: process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS,
  GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS:
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS,
  GITHUB_COPILOT_OPTIMIZATION_DISABLED:
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED,
}

beforeAll(async () => {
  await acquireSharedMutationLock(
    'tools/AgentTool/AgentTool.copilotScheduling.test.ts',
  )

  // Set the spy if not already set (it may have been set at module
  // top-level by a sibling test or by re-imports below).
  if (!getAPIProviderSpy) {
    getAPIProviderSpy = spyOn(providers, 'getAPIProvider').mockReturnValue(
      'github' as ReturnType<typeof providers.getAPIProvider>,
    )
  }

  // Stub runAgent and prompts so the AgentTool import doesn't pull in
  // the full streaming/scheduler stack for this minimal test.
  const actualRunAgent = await import(
    `./runAgent.ts?copilotSchedulingActual=${Date.now()}-${Math.random()}`
  )
  const actualPrompts = await import(
    `../../constants/prompts.ts?copilotSchedulingActual=${Date.now()}-${Math.random()}`
  )
  mock.module('./runAgent.js', () => ({
    ...actualRunAgent,
    runAgent: mock(async function* () {
      yield {
        type: 'assistant',
        uuid: 'assistant-1',
        message: {
          id: 'msg-1',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }
    }),
  }))
  mock.module('../../constants/prompts.js', () => ({
    ...actualPrompts,
    enhanceSystemPromptWithEnvDetails: mock(
      async (prompts: string[]) => prompts,
    ),
  }))

  const mod = await import(
    `./AgentTool.js?copilotScheduling=${Date.now()}-${Math.random()}`
  )
  AgentTool = mod.AgentTool
})

afterAll(() => {
  try {
    mock.restore()
    getAPIProviderSpy?.mockRestore()
  } finally {
    releaseSharedMutationLock()
  }
})

beforeEach(() => {
  // Default to GitHub provider (the spy is already set in beforeAll).
  // Reset env for each test.
  getAPIProviderSpy?.mockReturnValue(
    'github' as ReturnType<typeof providers.getAPIProvider>,
  )
  delete process.env.GITHUB_COPILOT_MAX_SUBAGENTS
  delete process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS
  delete process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS
  delete process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED
})

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_COPILOT_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('AgentTool.isConcurrencySafe() — Copilot scheduling contract', () => {
  // Pin the launch↔scheduler alignment for the GitHub provider under
  // each Copilot flag combination. The AgentTool's isConcurrencySafe()
  // must return:
  //   - true  when optimization is disabled (opt-out)
  //   - true  when ALLOW_SUBAGENTS=1 (async launch)
  //   - false when FORCE_SYNC=1 (sync launch)
  //   - false when cap > 0 (default cap=1, sync launch)
  //   - true  when cap = 0 (agents are suppressed at launch; the
  //     scheduler doesn't need to serialize them because they throw)
  //
  // A future reorder of the helpers in src/utils/copilotOptimization.ts
  // that breaks the precedence would fail one of the FORCE_SYNC or
  // ALLOW_SUBAGENTS rows below, locking the launch/scheduling alignment.

  test('OPTIMIZATION_DISABLED=1 — scheduler is concurrency-safe', () => {
    process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED = '1'
    expect(AgentTool!.isConcurrencySafe()).toBe(true)
  }, 30_000)

  test('default cap=1 (no other flags) — scheduler serializes', () => {
    // Default cap is 1, no ALLOW/FORCE/DISABLED. shouldForceSync returns
    // true; isConcurrencySafe returns false (must serialize).
    expect(AgentTool!.isConcurrencySafe()).toBe(false)
  }, 30_000)

  test('cap=2 (no other flags) — scheduler serializes', () => {
    // Per the copilotOptimization contract, cap=2 has the same effect
    // as cap=1 (force sync). Lock that the scheduler agrees.
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '2'
    expect(AgentTool!.isConcurrencySafe()).toBe(false)
  }, 30_000)

  test('ALLOW_SUBAGENTS=1 (default cap) — scheduler is concurrency-safe', () => {
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    expect(AgentTool!.isConcurrencySafe()).toBe(true)
  }, 30_000)

  test('FORCE_SYNC=1 alone — scheduler serializes', () => {
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS = '1'
    expect(AgentTool!.isConcurrencySafe()).toBe(false)
  }, 30_000)

  test('FORCE_SYNC=1 + ALLOW_SUBAGENTS=1 — FORCE_SYNC wins, scheduler serializes', () => {
    // This is the precedence the round-9 helper test pins; here we
    // verify the same precedence flows through the AgentTool boundary.
    process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS = '1'
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    expect(AgentTool!.isConcurrencySafe()).toBe(false)
  }, 30_000)

  test('cap=0 (agents suppressed at launch) — scheduler is concurrency-safe', () => {
    // When cap=0, agents throw at launch via shouldSuppressSubagentsInCopilotMode.
    // The scheduler doesn't need to serialize them because they never
    // execute. The helper shouldForceSync returns false for cap=0, so
    // isConcurrencySafe returns true.
    process.env.GITHUB_COPILOT_MAX_SUBAGENTS = '0'
    expect(AgentTool!.isConcurrencySafe()).toBe(true)
  }, 30_000)
})

/**
 * Scheduler-boundary regression: drive *multiple* Agent tool-use blocks through
 * the real batching path (`partitionToolCalls`) — not just `isConcurrencySafe()`
 * in isolation — so a regression where the orchestrator stops honoring the
 * return value for multiple Agent blocks is caught. `partitionToolCalls`
 * coalesces consecutive concurrency-safe blocks into one batch and isolates
 * non-safe ones into single-block batches; `runTools` then runs safe batches via
 * `runToolsConcurrently` and the rest serially.
 */
describe('partitionToolCalls — Copilot Agent scheduling boundary', () => {
  function agentBlock(id: string): ToolUseBlock {
    return {
      type: 'tool_use',
      id,
      name: AgentTool!.name,
      input: { description: 'do a thing', prompt: 'a task' },
    } as ToolUseBlock
  }

  function ctxWithAgentTool(): ToolUseContext {
    return {
      options: { tools: [AgentTool!] },
    } as unknown as ToolUseContext
  }

  test('default cap=1 (forced sync) — two Agent blocks split into serial batches', () => {
    // isConcurrencySafe() === false, so the two blocks must NOT be batched
    // together: each lands in its own non-concurrent batch and runs serially.
    const batches = orchestrationTest.partitionToolCalls(
      [agentBlock('a'), agentBlock('b')],
      ctxWithAgentTool(),
    )
    expect(batches.length).toBe(2)
    expect(batches.every(b => !b.isConcurrencySafe)).toBe(true)
    expect(batches.map(b => b.blocks.length)).toEqual([1, 1])
  }, 30_000)

  test('ALLOW_SUBAGENTS=1 — two Agent blocks coalesce into one concurrent batch', () => {
    process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS = '1'
    // isConcurrencySafe() === true, so consecutive Agent blocks batch together
    // and run via runToolsConcurrently.
    const batches = orchestrationTest.partitionToolCalls(
      [agentBlock('a'), agentBlock('b')],
      ctxWithAgentTool(),
    )
    expect(batches.length).toBe(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(batches[0]!.blocks.length).toBe(2)
  }, 30_000)
})
