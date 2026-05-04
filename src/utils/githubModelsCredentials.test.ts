import { describe, expect, test } from 'bun:test'

describe('readGithubModelsToken', () => {
  test('returns undefined in bare mode', async () => {
    const { readGithubModelsToken } = await import(
      // @ts-expect-error cache-busting query string for Bun module mocks
      './githubModelsCredentials.js?read-bare-mode'
    )

    const prev = process.env.CLAUDE_CODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(readGithubModelsToken()).toBeUndefined()
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = prev
    }
  })
})

describe('saveGithubModelsToken / clearGithubModelsToken', () => {
  test('save returns failure in bare mode', async () => {
    const { saveGithubModelsToken } = await import(
      // @ts-expect-error cache-busting query string for Bun module mocks
      './githubModelsCredentials.js?save-bare-mode'
    )

    const prev = process.env.CLAUDE_CODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'
    const r = saveGithubModelsToken('abc')
    expect(r.success).toBe(false)
    expect(r.warning).toContain('Bare mode')
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = prev
    }
  })

  test('clear succeeds in bare mode', async () => {
    const { clearGithubModelsToken } = await import(
      // @ts-expect-error cache-busting query string for Bun module mocks
      './githubModelsCredentials.js?clear-bare-mode'
    )

    const prev = process.env.CLAUDE_CODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(clearGithubModelsToken().success).toBe(true)
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = prev
    }
  })
})
