import { expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

import {
  call,
  resolveCacheProbeApiKey,
  resolveCacheProbeRequestApiKey,
  supportsCacheProbeFields,
} from './cache-probe.js'

test('cache-probe only sends OpenAI cache extensions to direct OpenAI API hosts (#2042)', () => {
  expect(supportsCacheProbeFields('https://api.openai.com/v1')).toBe(true)
  expect(supportsCacheProbeFields('https://eu.api.openai.com/v1')).toBe(true)
  expect(supportsCacheProbeFields('https://resource.openai.azure.com/openai/v1')).toBe(true)
  expect(supportsCacheProbeFields('https://integrate.api.nvidia.com/v1')).toBe(false)
  expect(supportsCacheProbeFields('https://compatible.example.test/v1')).toBe(false)
})

test('cache-probe omits cache extensions from NVIDIA NIM requests (#2042)', async () => {
  await acquireSharedMutationLock('commands/cache-probe/cache-probe.test.ts')
  const originalEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  let sentBody: Record<string, unknown> | undefined
  try {
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
    process.env.OPENAI_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.NVIDIA_NIM = '1'
    process.env.NVIDIA_API_KEY = 'test-key'
    globalThis.fetch = async (_input, init) => {
      sentBody = JSON.parse(String(init?.body))
      return new Response('unsupported fields', { status: 400 })
    }

    const result = await call('', {} as any)

    expect(result.type).toBe('text')
    expect(sentBody).toBeDefined()
    expect(sentBody).not.toHaveProperty('prompt_cache_key')
    expect(sentBody).not.toHaveProperty('prompt_cache_retention')
    expect(sentBody).not.toHaveProperty('store')
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
    releaseSharedMutationLock()
  }
})

test('resolveCacheProbeApiKey prefers the first usable OPENAI_API_KEYS entry', () => {
  expect(
    resolveCacheProbeApiKey({
      OPENAI_API_KEYS: 'key-a,key-b',
      OPENAI_API_KEY: 'single-key',
    } as NodeJS.ProcessEnv),
  ).toBe('key-a')
})

test('resolveCacheProbeApiKey ignores placeholder OPENAI_API_KEY when OPENAI_API_KEYS is usable', () => {
  expect(
    resolveCacheProbeApiKey({
      OPENAI_API_KEYS: 'key-a,key-b',
      OPENAI_API_KEY: 'SUA_CHAVE',
    } as NodeJS.ProcessEnv),
  ).toBe('key-a')
})

test('resolveCacheProbeApiKey rejects placeholder values inside credential pools', () => {
  expect(
    resolveCacheProbeApiKey({
      OPENAI_API_KEYS: 'key-a,SUA_CHAVE',
      OPENAI_API_KEY: 'key-single',
    } as NodeJS.ProcessEnv),
  ).toBe('')
})

test('resolveCacheProbeApiKey falls back to comma-separated OPENAI_API_KEY', () => {
  expect(
    resolveCacheProbeApiKey({
      OPENAI_API_KEY: 'key-a,key-b',
    } as NodeJS.ProcessEnv),
  ).toBe('key-a')
})

test('resolveCacheProbeRequestApiKey prefers GitHub credentials in GitHub mode', () => {
  expect(
    resolveCacheProbeRequestApiKey(
      {
        CLAUDE_CODE_USE_GITHUB: '1',
        OPENAI_API_KEYS: 'openai-key-a,openai-key-b',
        GITHUB_TOKEN: 'github-token',
      } as NodeJS.ProcessEnv,
      { isGithub: true },
    ),
  ).toBe('github-token')
})

test('cache-probe no-key guidance mentions pooled OpenAI credentials', async () => {
  await acquireSharedMutationLock('commands/cache-probe/cache-probe.test.ts')
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
    releaseSharedMutationLock()
  }
})
