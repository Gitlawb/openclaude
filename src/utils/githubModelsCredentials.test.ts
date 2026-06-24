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
