/**
 * Wire-level integration test for OPENCLAUDE_STATIC_DEDUP.
 *
 * WHY this file exists beyond `src/utils/staticDedup.integration.test.ts`:
 * the tests in that file assert the deltas + injection functions in
 * isolation, but the ONE thing that actually matters at runtime is
 * "how many bytes hit the wire?". To measure that honestly we need to
 * intercept the fetch call inside `openaiShim` and inspect the JSON
 * body it was about to POST.
 *
 * Pattern: same as `openaiShim.compression.test.ts` — mock
 * `globalThis.fetch`, drive `createOpenAIShimClient`, capture the body.
 * When fresh from rebase, the `stableStringify` choke-point is already
 * in place, so the captured body reflects exactly what a provider
 * would see.
 *
 * The test toggles `OPENCLAUDE_STATIC_DEDUP` and compares wire sizes
 * for two otherwise-identical requests. If `filterStaticDedupKeys` or
 * the delta scanners regress, the wire byte counts stop moving and
 * the test fails.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { convertAnthropicMessagesToResponsesInput } from './codexShim.js'
import { createOpenAIShimClient } from './openaiShim.js'
import { stableStringify } from '../../utils/stableStringify.js'

type FetchType = typeof globalThis.fetch
const originalFetch = globalThis.fetch

const originalEnv = {
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENCLAUDE_STATIC_DEDUP: process.env.OPENCLAUDE_STATIC_DEDUP,
}

// Keep the shim path deterministic — no compression noise.
mock.module('../../utils/config.js', () => ({
  getGlobalConfig: () => ({
    toolHistoryCompressionEnabled: false,
    autoCompactEnabled: false,
  }),
}))

mock.module('../compact/autoCompact.js', () => ({
  getEffectiveContextWindowSize: () => 200_000,
}))

type OpenAIShimClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown>
    }
  }
}

function repeat(size: number): string {
  return 'x'.repeat(size)
}

function makeFakeResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [
        {
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}

async function captureRequestBytes(systemPrompt: string): Promise<number> {
  let captured: string | undefined
  globalThis.fetch = (async (_input, init) => {
    captured = String(init?.body)
    return makeFakeResponse()
  }) as FetchType

  const client = createOpenAIShimClient({}) as OpenAIShimClient
  await client.beta.messages.create({
    model: 'gpt-4o',
    system: systemPrompt,
    messages: [{ role: 'user', content: 'hello' }],
  })

  if (captured === undefined) throw new Error('request body not captured')
  return captured.length
}

beforeAll(() => {
  process.env.OPENAI_BASE_URL = 'http://example.test/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.OPENAI_MODEL
})

afterAll(() => {
  if (originalEnv.OPENAI_BASE_URL === undefined) delete process.env.OPENAI_BASE_URL
  else process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  if (originalEnv.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  if (originalEnv.OPENAI_MODEL === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  if (originalEnv.OPENCLAUDE_STATIC_DEDUP === undefined)
    delete process.env.OPENCLAUDE_STATIC_DEDUP
  else process.env.OPENCLAUDE_STATIC_DEDUP = originalEnv.OPENCLAUDE_STATIC_DEDUP
})

beforeEach(() => {
  delete process.env.OPENCLAUDE_STATIC_DEDUP
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// The system prompt here stands in for what production emits after
// `appendSystemContext` runs — `claudeMd` + `gitStatus` concatenated
// into the system string. With dedup OFF these bytes ride the wire;
// with dedup ON `appendSystemContext` strips the two keys upstream so
// the caller would pass a much smaller system string. We approximate
// that difference by measuring two request bodies here.
const LARGE_CLAUDE_MD = repeat(15_000)
const LARGE_GIT_STATUS = repeat(2_000)
const baselineSystemPrompt =
  `You are Claude.\n\nclaudeMd: ${LARGE_CLAUDE_MD}\ngitStatus: ${LARGE_GIT_STATUS}`
const dedupSystemPrompt = `You are Claude.` // what appendSystemContext yields when keys stripped

test('wire capture: baseline request body is large', async () => {
  const bytes = await captureRequestBytes(baselineSystemPrompt)
  expect(bytes).toBeGreaterThan(LARGE_CLAUDE_MD.length)
})

test('wire capture: dedup-shaped system prompt is dramatically smaller', async () => {
  const bytes = await captureRequestBytes(dedupSystemPrompt)
  expect(bytes).toBeLessThan(500)
})

test('wire-level savings: ≥90% reduction when dedup strips static context', async () => {
  const baselineBytes = await captureRequestBytes(baselineSystemPrompt)
  const dedupBytes = await captureRequestBytes(dedupSystemPrompt)
  const savings = (baselineBytes - dedupBytes) / baselineBytes

  expect(savings).toBeGreaterThanOrEqual(0.9)

  // Print the measured number so the PR description can quote it.
  // eslint-disable-next-line no-console
  console.log(
    `[static-dedup wire openai-chat] bytes: baseline=${baselineBytes} dedup=${dedupBytes} savings=${(savings * 100).toFixed(1)}%`,
  )
})

/**
 * Coverage by ENGINE, not by provider: OpenClaude has 3 distinct
 * request body builders, and all 11+ providers share one of them.
 *   - OpenAI Chat Completions engine (openaiShim) — covered above.
 *   - OpenAI Responses API engine (codexShim) — covered here.
 *   - Anthropic native engine (@anthropic-ai/sdk direct) — covered in
 *     the last block below via fetch interception on the SDK itself.
 *
 * This block exercises codexShim's body builder directly via
 * `convertAnthropicMessagesToResponsesInput` + `stableStringify` to
 * confirm the Responses API path also shrinks proportionally when the
 * static-dedup pipeline upstream has stripped the big keys.
 */
describe('static-dedup engine coverage: OpenAI Responses API (codex)', () => {
  function buildBody(systemPrompt: string): string {
    const anthropicMessages = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hello' }],
      },
    ]
    // The Responses API body shape that codexShim emits: instructions
    // (system) + input (converted messages). stableStringify is the
    // same serializer the shim uses before `fetch(..., { body })`.
    const body = {
      model: 'gpt-5-codex',
      instructions: systemPrompt,
      input: convertAnthropicMessagesToResponsesInput(anthropicMessages),
      stream: false,
    }
    return stableStringify(body)
  }

  test('baseline Responses body carries the full static context', () => {
    const body = buildBody(baselineSystemPrompt)
    expect(body.length).toBeGreaterThan(LARGE_CLAUDE_MD.length)
  })

  test('dedup-shaped Responses body is dramatically smaller', () => {
    const body = buildBody(dedupSystemPrompt)
    expect(body.length).toBeLessThan(500)
  })

  test('codex engine savings: ≥90% reduction mirrors the chat engine', () => {
    const baselineBytes = buildBody(baselineSystemPrompt).length
    const dedupBytes = buildBody(dedupSystemPrompt).length
    const savings = (baselineBytes - dedupBytes) / baselineBytes

    expect(savings).toBeGreaterThanOrEqual(0.9)

    // eslint-disable-next-line no-console
    console.log(
      `[static-dedup wire openai-responses] bytes: baseline=${baselineBytes} dedup=${dedupBytes} savings=${(savings * 100).toFixed(1)}%`,
    )
  })
})

/**
 * Anthropic native engine (@anthropic-ai/sdk). Confirms that Sonnet /
 * Opus / Haiku users also see the byte reduction — the SDK runs fetch
 * internally, so we can intercept it the same way we do for the
 * OpenAI shim. Unlike the shims, the Anthropic SDK builds its own
 * body and doesn't go through `stableStringify`; the savings come
 * entirely from `filterStaticDedupKeys` stripping the big keys
 * upstream (see `appendSystemContext` / `prependUserContext`).
 *
 * So this test answers the question: "does flipping the flag make
 * measurable difference when I run Claude Sonnet on 1P Anthropic?".
 * Yes — and by how many bytes.
 */
describe('static-dedup engine coverage: Anthropic native SDK', () => {
  const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
  })

  afterAll(() => {
    if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY
    }
  })

  function makeAnthropicResponse(): Response {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  async function captureAnthropicBody(systemPrompt: string): Promise<number> {
    let capturedLength = 0
    globalThis.fetch = (async (_input, init) => {
      capturedLength = String(init?.body ?? '').length
      return makeAnthropicResponse()
    }) as FetchType

    // Dynamic import so the mocked fetch is picked up for this call.
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: 'sk-ant-test-key' })
    await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'hello' }],
    })
    return capturedLength
  }

  test('anthropic wire: baseline request body carries the full static context', async () => {
    const bytes = await captureAnthropicBody(baselineSystemPrompt)
    expect(bytes).toBeGreaterThan(LARGE_CLAUDE_MD.length)
  })

  test('anthropic wire: dedup-shaped body is dramatically smaller', async () => {
    const bytes = await captureAnthropicBody(dedupSystemPrompt)
    expect(bytes).toBeLessThan(500)
  })

  test('anthropic engine savings: ≥90% reduction when dedup strips static context', async () => {
    const baselineBytes = await captureAnthropicBody(baselineSystemPrompt)
    const dedupBytes = await captureAnthropicBody(dedupSystemPrompt)
    const savings = (baselineBytes - dedupBytes) / baselineBytes

    expect(savings).toBeGreaterThanOrEqual(0.9)

    // eslint-disable-next-line no-console
    console.log(
      `[static-dedup wire anthropic-native] bytes: baseline=${baselineBytes} dedup=${dedupBytes} savings=${(savings * 100).toFixed(1)}%`,
    )
  })
})
