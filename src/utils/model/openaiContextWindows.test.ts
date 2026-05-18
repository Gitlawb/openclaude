import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = {
  CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS:
    process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS,
  CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS:
    process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

type ConfigShape = {
  modelLimits?: Record<
    string,
    { contextWindow?: number; maxOutputTokens?: number } | null
  > | null
}

let mockConfig: ConfigShape = {}

beforeEach(async () => {
  await acquireSharedMutationLock('openaiContextWindows.test.ts')
  mock.restore()
  mockConfig = {}
  delete process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS
  delete process.env.CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS
  delete process.env.OPENAI_BASE_URL
  const actualConfig = await import(`../config.js?ts=${Date.now()}-${Math.random()}`)
  mock.module('../config.js', () => ({
    ...actualConfig,
    getGlobalConfig: () => mockConfig,
  }))
})

afterEach(() => {
  try {
    mock.restore()
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  } finally {
    releaseSharedMutationLock('openaiContextWindows.test.ts')
  }
})

async function importFresh() {
  const nonce = `${Date.now()}-${Math.random()}`
  return await import(`./openaiContextWindows.js?ts=${nonce}`)
}

test('settings modelLimits resolves context window when no env override is set', async () => {
  mockConfig = {
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
  mockConfig = {
    modelLimits: {
      'qwen3.6-plus': { contextWindow: 1_048_576 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(524_288)
})

test('settings modelLimits supports prefix matching on the model name', async () => {
  mockConfig = {
    modelLimits: {
      'qwen3': { contextWindow: 262_144 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(262_144)
})

test('settings modelLimits supports host-qualified keys', async () => {
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  mockConfig = {
    modelLimits: {
      'qwen3.6-plus': { contextWindow: 200_000 },
      'openrouter.ai:qwen3.6-plus': { contextWindow: 1_048_576 },
    },
  }
  const { getOpenAIContextWindow } = await importFresh()

  expect(getOpenAIContextWindow('qwen3.6-plus')).toBe(1_048_576)
})

test('missing modelLimits returns undefined', async () => {
  mockConfig = {}
  const { getOpenAIContextWindow, getOpenAIMaxOutputTokens } = await importFresh()

  expect(getOpenAIContextWindow('whatever')).toBeUndefined()
  expect(getOpenAIMaxOutputTokens('whatever')).toBeUndefined()
})

test('invalid modelLimits entries are skipped without throwing', async () => {
  mockConfig = {
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
