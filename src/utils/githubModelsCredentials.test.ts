import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalSimple = process.env.CLAUDE_CODE_SIMPLE

type GithubModelsCredentialsModule =
  typeof import('./githubModelsCredentials.js')

function importFreshGithubModelsCredentials(
  cacheKey: string,
): Promise<GithubModelsCredentialsModule> {
  return import(
    `./githubModelsCredentials.js?${cacheKey}`
  ) as Promise<GithubModelsCredentialsModule>
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/githubModelsCredentials.test.ts')
})

afterEach(() => {
  try {
    if (originalSimple === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = originalSimple
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('readGithubModelsToken', () => {
  test('returns undefined in bare mode', async () => {
    const { readGithubModelsToken } =
      await importFreshGithubModelsCredentials('read-bare-mode')

    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(readGithubModelsToken()).toBeUndefined()
  })
})

describe('saveGithubModelsToken / clearGithubModelsToken', () => {
  test('save returns failure in bare mode', async () => {
    const { saveGithubModelsToken } =
      await importFreshGithubModelsCredentials('save-bare-mode')

    process.env.CLAUDE_CODE_SIMPLE = '1'
    const r = saveGithubModelsToken('abc')
    expect(r.success).toBe(false)
    expect(r.warning).toContain('Bare mode')
  })

  test('clear succeeds in bare mode', async () => {
    const { clearGithubModelsToken } =
      await importFreshGithubModelsCredentials('clear-bare-mode')

    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(clearGithubModelsToken().success).toBe(true)
  })
})

describe('clearHydratedGithubModelsTokenFromEnv', () => {
  test('drops a hydrated token that matches secure storage, with its marker', async () => {
    const { clearHydratedGithubModelsTokenFromEnv, GITHUB_MODELS_HYDRATED_ENV_MARKER } =
      await importFreshGithubModelsCredentials('clear-hydrated-match')

    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    process.env.GITHUB_TOKEN = 'stored-tok'
    try {
      clearHydratedGithubModelsTokenFromEnv('stored-tok')
      expect(process.env.GITHUB_TOKEN).toBeUndefined()
      expect(process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]).toBeUndefined()
    } finally {
      delete process.env.GITHUB_TOKEN
      delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    }
  })

  test('preserves a user-supplied token that differs from secure storage', async () => {
    const { clearHydratedGithubModelsTokenFromEnv, GITHUB_MODELS_HYDRATED_ENV_MARKER } =
      await importFreshGithubModelsCredentials('clear-hydrated-user')

    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    process.env.GITHUB_TOKEN = 'user-supplied'
    try {
      clearHydratedGithubModelsTokenFromEnv('stored-tok')
      expect(process.env.GITHUB_TOKEN).toBe('user-supplied')
      expect(process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]).toBeUndefined()
    } finally {
      delete process.env.GITHUB_TOKEN
      delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    }
  })

  test('drops the token when secure storage is empty but the marker is set', async () => {
    const { clearHydratedGithubModelsTokenFromEnv, GITHUB_MODELS_HYDRATED_ENV_MARKER } =
      await importFreshGithubModelsCredentials('clear-hydrated-nostore')

    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    process.env.GITHUB_TOKEN = 'hydrated-tok'
    try {
      clearHydratedGithubModelsTokenFromEnv(undefined)
      expect(process.env.GITHUB_TOKEN).toBeUndefined()
      expect(process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]).toBeUndefined()
    } finally {
      delete process.env.GITHUB_TOKEN
      delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    }
  })

  test('is a no-op when the hydration marker is absent', async () => {
    const { clearHydratedGithubModelsTokenFromEnv, GITHUB_MODELS_HYDRATED_ENV_MARKER } =
      await importFreshGithubModelsCredentials('clear-hydrated-nomarker')

    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    process.env.GITHUB_TOKEN = 'untouched'
    try {
      clearHydratedGithubModelsTokenFromEnv('stored-tok')
      expect(process.env.GITHUB_TOKEN).toBe('untouched')
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  test('drops a hydrated Copilot key that matches secure storage, with its marker', async () => {
    const { clearHydratedGithubModelsTokenFromEnv, GITHUB_MODELS_HYDRATED_ENV_MARKER } =
      await importFreshGithubModelsCredentials('clear-hydrated-copilot-match')

    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    process.env.GITHUB_COPILOT_KEY = 'stored-key'
    try {
      clearHydratedGithubModelsTokenFromEnv('stored-key')
      expect(process.env.GITHUB_COPILOT_KEY).toBeUndefined()
      expect(process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]).toBeUndefined()
    } finally {
      delete process.env.GITHUB_COPILOT_KEY
      delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    }
  })

  test('preserves a user-supplied Copilot key that differs from secure storage', async () => {
    const { clearHydratedGithubModelsTokenFromEnv, GITHUB_MODELS_HYDRATED_ENV_MARKER } =
      await importFreshGithubModelsCredentials('clear-hydrated-copilot-user')

    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    process.env.GITHUB_COPILOT_KEY = 'user-supplied'
    try {
      clearHydratedGithubModelsTokenFromEnv('stored-key')
      expect(process.env.GITHUB_COPILOT_KEY).toBe('user-supplied')
      expect(process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]).toBeUndefined()
    } finally {
      delete process.env.GITHUB_COPILOT_KEY
      delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    }
  })
})
