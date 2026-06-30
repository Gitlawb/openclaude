import { expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

import {
  call,
  resolveCacheProbeApiKey,
  resolveCacheProbeRequestApiKey,
} from './cache-probe.js'

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
