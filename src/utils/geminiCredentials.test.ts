import { afterEach, expect, test } from 'bun:test'

import {
  clearGeminiAccessToken,
  readGeminiAccessToken,
  saveGeminiAccessToken,
} from './geminiCredentials.ts'

const originalToken = process.env.GEMINI_ACCESS_TOKEN

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.GEMINI_ACCESS_TOKEN
  } else {
    process.env.GEMINI_ACCESS_TOKEN = originalToken
  }
  clearGeminiAccessToken()
})

test('saveGeminiAccessToken stores and reads back the token', () => {
  const result = saveGeminiAccessToken('token-123')
  expect(result.success).toBe(true)
  expect(readGeminiAccessToken()).toBe('token-123')
})

test('clearGeminiAccessToken removes the stored token', () => {
  expect(saveGeminiAccessToken('token-123').success).toBe(true)
  expect(clearGeminiAccessToken().success).toBe(true)
  expect(readGeminiAccessToken()).toBeUndefined()
})

