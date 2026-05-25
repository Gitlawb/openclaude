import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

async function importAutoCompact() {
  mock.restore()
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./autoCompact.ts?test=${nonce}`)
}

const SAVED_ENV = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
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
  CLAUDE_CODE_MAX_CONTEXT_TOKENS:
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW:
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
  CLAUDE_CODE_MAX_OUTPUT_TOKENS:
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
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

beforeEach(async () => {
  await acquireSharedMutationLock('services/compact/autoCompact.test.ts')
})

afterEach(() => {
  try {
    restoreEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('getEffectiveContextWindowSize', () => {
  test('returns positive value for known models with large context windows', async () => {
    const { getEffectiveContextWindowSize } = await importAutoCompact()
    // claude-sonnet-4 has 200k context
    const effective = getEffectiveContextWindowSize('claude-sonnet-4')
    expect(effective).toBeGreaterThan(0)
  })

  test('never returns negative even for unknown 3P models (issue #635)', async () => {
    const { getEffectiveContextWindowSize } = await importAutoCompact()
    // Previously, unknown 3P models got 8k context → effective context was
    // 8k minus 20k summary reservation = -12k, causing infinite auto-compact.
    // Now the fallback is 128k and there's a floor, so effective is always
    // at least reservedTokensForSummary + buffer.
    //
    // The exact floor depends on the max-output-tokens slot-reservation cap
    // (tengu_otk_slot_v1 GrowthBook flag). With cap enabled, the model's
    // default output cap drops to CAPPED_DEFAULT_MAX_TOKENS (8k), so the
    // summary reservation is 8k and the floor is 8k + 13k = 21k. With cap
    // disabled it's 20k + 13k = 33k. Assert the worst case so the test is
    // stable regardless of flag state in CI vs local.
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    try {
      const effective = getEffectiveContextWindowSize('some-unknown-3p-model')
      expect(effective).toBeGreaterThan(0)
      // 21k = CAPPED_DEFAULT_MAX_TOKENS (8k) + AUTOCOMPACT_BUFFER_TOKENS (13k).
      // Covers the anti-regression intent of issue #635 without assuming
      // the GrowthBook flag state.
      expect(effective).toBeGreaterThanOrEqual(21_000)
    } finally {
      restoreEnv()
    }
  })

  test('uses MiniMax M2 context and output metadata for compact budget', async () => {
    const { getEffectiveContextWindowSize } = await importAutoCompact()
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_MISTRAL
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    delete process.env.XAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_MODEL
    delete process.env.USER_TYPE
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_API_KEY = 'ambient-openai-key'
    process.env.MINIMAX_API_KEY = 'minimax-test'
    process.env.OPENAI_MODEL = 'MiniMax-M2.7'

    try {
      // MiniMax's recommended Anthropic-compatible endpoint supports the full
      // M2 window. Compact reserves either the default 20k summary output
      // tokens or 8k when the slot-reservation cap flag is enabled.
      expect([184_800, 196_800]).toContain(
        getEffectiveContextWindowSize('MiniMax-M2.7'),
      )
    } finally {
      restoreEnv()
    }
  })
})

describe('getAutoCompactThreshold', () => {
  test('returns positive threshold for known models', async () => {
    const { getAutoCompactThreshold } = await importAutoCompact()
    const threshold = getAutoCompactThreshold('claude-sonnet-4')
    expect(threshold).toBeGreaterThan(0)
  })

  test('never returns negative threshold even for unknown 3P models (issue #635)', async () => {
    const { getAutoCompactThreshold } = await importAutoCompact()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    try {
      const threshold = getAutoCompactThreshold('some-unknown-3p-model')
      expect(threshold).toBeGreaterThan(0)
    } finally {
      restoreEnv()
    }
  })
})
