import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

// @ts-expect-error -- query-string cache-buster: the `?...` suffix makes Bun
// treat this as a distinct module id, bypassing other suites'
// mock.module('../settings/settings.js') registrations so we capture the
// genuine module. Importing it at module scope (once) keeps the real-module
// load out of beforeEach, where the cold dynamic import sat right at Bun's 5s
// hook-timeout boundary and intermittently failed the first test.
import * as realSettingsModule from '../settings/settings.js?openaiContextWindowsRealSettings'

const originalEnv = {
  CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS:
    process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS,
  CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS:
    process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

type SettingsShape = {
  // Deliberately permissive (allows null entries) so the defensive-handling
  // test can feed malformed shapes that real settings typing would reject.
  modelLimits?: Record<
    string,
    { contextWindow?: number; maxOutputTokens?: number } | null
  >
}

let mockSettings: SettingsShape = {}
// Gate the getInitialSettings override so the process-global mock.module is a
// transparent passthrough to the real settings whenever this suite is not the
// one running — settings.js is read by many suites, so a stub must not leak.
let settingsOverrideActive = false

beforeEach(async () => {
  await acquireSharedMutationLock('openaiContextWindows.test.ts')
  mock.restore()
  mockSettings = {}
  delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
  delete process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_BASE_URL
  mock.module('../settings/settings.js', () => ({
    ...realSettingsModule,
    getInitialSettings: () =>
      settingsOverrideActive
        ? mockSettings
        : realSettingsModule.getInitialSettings(),
  }))
  settingsOverrideActive = true
})

afterEach(() => {
  try {
    mock.restore()
    settingsOverrideActive = false
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFresh() {
  const nonce = `${Date.now()}-${Math.random()}`
  return await import(`./openaiContextWindows.js?ts=${nonce}`)
}

test('settings modelLimits resolves context window when no env override is set', async () => {
  mockSettings = {
    modelLimits: {
      'qwen3.6-plus': { contextWindow: 1_048_576, maxOutputTokens: 32_768 },
    },
  }
  const { getOpenAIContextWindow, getOpenAIMaxOutputTokens } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(1_048_576)
  expect(getOpenAIMaxOutputTokens('qwen3.6-plus')).toBe(32_768)
})

test('env override takes precedence over settings modelLimits', async () => {
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'qwen3.6-plus': 524_288,
  })
  mockSettings = {
    modelLimits: {
      'qwen3.6-plus': { contextWindow: 1_048_576 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(524_288)
})

test('settings modelLimits supports prefix matching on the model name', async () => {
  mockSettings = {
    modelLimits: {
      'qwen3': { contextWindow: 262_144 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(262_144)
})

test('settings modelLimits supports host-qualified keys', async () => {
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  mockSettings = {
    modelLimits: {
      'qwen3.6-plus': { contextWindow: 200_000 },
      'openrouter.ai:qwen3.6-plus': { contextWindow: 1_048_576 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(1_048_576)
})

test('a bare exact key beats a host-qualified prefix for a different model', async () => {
  // An exact match wins over any prefix, including a host-qualified one. Here
  // the host-qualified `openrouter.ai:qwen3` only prefix-matches, while
  // `qwen3.6-plus` is an exact match for the requested model, so the exact
  // bare limit must win. To force a per-endpoint override for this model the
  // user supplies a host-qualified EXACT key (covered by the test above).
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  mockSettings = {
    modelLimits: {
      'qwen3.6-plus': { contextWindow: 200_000 },
      'openrouter.ai:qwen3': { contextWindow: 1_048_576 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(200_000)
})

test('missing modelLimits returns undefined', async () => {
  mockSettings = {}
  const { getOpenAIContextWindow, getOpenAIMaxOutputTokens } = await importFresh()

  expect(getOpenAIContextWindow('whatever')).toBeUndefined()
  expect(getOpenAIMaxOutputTokens('whatever')).toBeUndefined()
})

test('invalid modelLimits entries are skipped without throwing', async () => {
  mockSettings = {
    modelLimits: {
      'bad-zero': { contextWindow: 0 },
      'bad-negative': { contextWindow: -1 },
      'bad-shape': null,
      'good': { contextWindow: 64_000 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('bad-zero')).toBeUndefined()
  expect(getOpenAIContextWindow('bad-negative')).toBeUndefined()
  expect(getOpenAIContextWindow('bad-shape')).toBeUndefined()
  expect(getOpenAIContextWindow('good')).toBe(64_000)
})
