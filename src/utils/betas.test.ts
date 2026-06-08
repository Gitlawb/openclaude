import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import {
  CLAUDE_CODE_20250219_BETA_HEADER,
} from '../constants/betas.js'
import { setSdkBetas } from '../bootstrap/state.js'

// Beta headers are Anthropic-specific. PR #1533 added a provider gate so that
// non-Anthropic providers (OpenAI, Gemini, etc.) never receive Anthropic-only
// beta headers — they would reject requests with unknown headers. These tests
// pin that gate: getMergedBetas() must return [] for non-Anthropic providers
// and a non-empty list for Anthropic providers (plus GitHub Native Anthropic).

const PROVIDER_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'NVIDIA_NIM',
  'MINIMAX_API_KEY',
  'XAI_API_KEY',
  'VENICE_API_KEY',
  'MIMO_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BETAS',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'USER_TYPE',
  'CLAUDE_CODE_ENTRYPOINT',
  'DISABLE_INTERLEAVED_THINKING',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
] as const

const originalEnv: Record<string, string | undefined> = {}
for (const key of PROVIDER_ENV_KEYS) {
  originalEnv[key] = process.env[key]
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key]
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/betas.test.ts')
  mock.restore()
  clearProviderEnv()
})

afterEach(() => {
  try {
    restoreEnv()
    setSdkBetas(undefined)
  } finally {
    releaseSharedMutationLock()
  }
})

// Fresh import per test resets the memoize caches inside betas.js so the
// provider detection (read live from process.env) is re-evaluated cleanly.
async function importFreshBetas() {
  return import(`./betas.js?ts=${Date.now()}-${Math.random()}`)
}

const MODEL = 'claude-sonnet-4-5'

// --- getMergedBetas: non-Anthropic providers return [] ---

test('getMergedBetas returns [] for the openai provider', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL)).toEqual([])
})

test('getMergedBetas returns [] for the gemini provider', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL)).toEqual([])
})

// --- getMergedBetas: Anthropic providers return a non-empty list ---

test('getMergedBetas returns a non-empty list for the firstParty provider', async () => {
  // No provider env set => firstParty.
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL).length).toBeGreaterThan(0)
})

test('getMergedBetas returns a non-empty list for the bedrock provider', async () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL).length).toBeGreaterThan(0)
})

test('getMergedBetas returns a non-empty list for the vertex provider', async () => {
  process.env.CLAUDE_CODE_USE_VERTEX = '1'
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL).length).toBeGreaterThan(0)
})

test('getMergedBetas returns a non-empty list for the foundry provider', async () => {
  process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL).length).toBeGreaterThan(0)
})

test('getMergedBetas returns a non-empty list in GitHub Native Anthropic mode', async () => {
  // GitHub resolves to the (non-Anthropic) "github" provider, but when the
  // model is a Claude model the request uses Anthropic native format, so the
  // beta headers must still flow through.
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.ANTHROPIC_BASE_URL = 'https://api.githubcopilot.com'
  process.env.ANTHROPIC_API_KEY = 'gh-token'
  process.env.OPENAI_MODEL = MODEL
  const { getMergedBetas } = await importFreshBetas()
  expect(getMergedBetas(MODEL).length).toBeGreaterThan(0)
})

// --- isAnthropicProvider ---

test('isAnthropicProvider is true for firstParty', async () => {
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(true)
})

test('isAnthropicProvider is true for bedrock', async () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(true)
})

test('isAnthropicProvider is true for vertex', async () => {
  process.env.CLAUDE_CODE_USE_VERTEX = '1'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(true)
})

test('isAnthropicProvider is true for foundry', async () => {
  process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(true)
})

test('isAnthropicProvider is false for the openai provider', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(false)
})

test('isAnthropicProvider is false for the gemini provider', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(false)
})

test('isAnthropicProvider is false for the mistral provider', async () => {
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(false)
})

test('isAnthropicProvider is false for the xai provider', async () => {
  process.env.XAI_API_KEY = 'xai-test-key'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(false)
})

test('isAnthropicProvider is false for the minimax provider', async () => {
  process.env.MINIMAX_API_KEY = 'minimax-test-key'
  const { isAnthropicProvider } = await importFreshBetas()
  expect(isAnthropicProvider()).toBe(false)
})

// --- Anthropic-only beta header handling (from origin/main) ---

test('adds trimmed user-provided beta headers without empty entries', async () => {
  process.env.ANTHROPIC_BETAS =
    ' custom-beta-2026-01-01, ,second-beta-2026-02-02 '

  const { getAllModelBetas } = await importFreshBetas()
  const betas = getAllModelBetas('claude-3-haiku-20240307')

  expect(betas.slice(-2)).toEqual([
    'custom-beta-2026-01-01',
    'second-beta-2026-02-02',
  ])
  expect(betas).not.toContain('')
})

test('does not duplicate an env-provided agentic beta for Haiku requests', async () => {
  process.env.ANTHROPIC_BETAS = [
    CLAUDE_CODE_20250219_BETA_HEADER,
    'custom-beta-2026-01-01',
  ].join(',')

  const { getMergedBetas } = await importFreshBetas()
  const mergedBetas = getMergedBetas('claude-3-haiku-20240307', {
    isAgenticQuery: true,
  })

  expect(
    mergedBetas.filter(beta => beta === CLAUDE_CODE_20250219_BETA_HEADER),
  ).toHaveLength(1)
  expect(mergedBetas).toContain('custom-beta-2026-01-01')
})
