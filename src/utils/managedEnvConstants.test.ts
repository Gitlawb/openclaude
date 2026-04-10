import { expect, test } from 'bun:test'

import { isProviderManagedEnvVar } from './managedEnvConstants.js'

test('treats OpenClaude OpenAI/Gemini routing vars as host-managed provider vars', () => {
  expect(isProviderManagedEnvVar('CLAUDE_CODE_USE_OPENAI')).toBe(true)
  expect(isProviderManagedEnvVar('OPENAI_MODEL')).toBe(true)
  expect(isProviderManagedEnvVar('OPENAI_BASE_URL')).toBe(true)
  expect(isProviderManagedEnvVar('CLAUDE_CODE_USE_GEMINI')).toBe(true)
  expect(isProviderManagedEnvVar('GEMINI_MODEL')).toBe(true)
  expect(isProviderManagedEnvVar('GEMINI_BASE_URL')).toBe(true)
})
