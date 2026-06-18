import { expect, test } from 'bun:test'

import { call, resolveCacheProbeApiKey } from './cache-probe.js'

test('resolveCacheProbeApiKey prefers the first usable OPENAI_API_KEYS entry', () => {
  expect(
    resolveCacheProbeApiKey({
      OPENAI_API_KEYS: 'key-a,key-b',
      OPENAI_API_KEY: 'single-key',
    } as NodeJS.ProcessEnv),
  ).toBe('key-a')
})

test('resolveCacheProbeApiKey falls back to comma-separated OPENAI_API_KEY', () => {
  expect(
    resolveCacheProbeApiKey({
      OPENAI_API_KEY: 'key-a,key-b',
    } as NodeJS.ProcessEnv),
  ).toBe('key-a')
})

test('cache-probe no-key guidance mentions pooled OpenAI credentials', async () => {
  const originalEnv = { ...process.env }
  try {
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    process.env.OPENAI_MODEL = 'gpt-5.5'

    const result = await call('', {} as any)

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text result')
    expect(result.value).toContain('OPENAI_API_KEYS or OPENAI_API_KEY')
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  }
})