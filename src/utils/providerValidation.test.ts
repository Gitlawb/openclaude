import { afterEach, expect, test } from 'bun:test'

import {
  getProviderValidationError,
  shouldExitForStartupProviderValidationError,
} from './providerValidation.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  CHATGPT_ACCOUNT_ID: process.env.CHATGPT_ACCOUNT_ID,
  CODEX_ACCOUNT_ID: process.env.CODEX_ACCOUNT_ID,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GEMINI_ACCESS_TOKEN: process.env.GEMINI_ACCESS_TOKEN,
  GEMINI_AUTH_MODE: process.env.GEMINI_AUTH_MODE,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
  restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
  restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
  restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
  restoreEnv('CODEX_API_KEY', originalEnv.CODEX_API_KEY)
  restoreEnv('CHATGPT_ACCOUNT_ID', originalEnv.CHATGPT_ACCOUNT_ID)
  restoreEnv('CODEX_ACCOUNT_ID', originalEnv.CODEX_ACCOUNT_ID)
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN)
  restoreEnv('GH_TOKEN', originalEnv.GH_TOKEN)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
  restoreEnv('GOOGLE_API_KEY', originalEnv.GOOGLE_API_KEY)
  restoreEnv('GEMINI_ACCESS_TOKEN', originalEnv.GEMINI_ACCESS_TOKEN)
  restoreEnv('GEMINI_AUTH_MODE', originalEnv.GEMINI_AUTH_MODE)
  restoreEnv(
    'GOOGLE_APPLICATION_CREDENTIALS',
    originalEnv.GOOGLE_APPLICATION_CREDENTIALS,
  )
})

test('accepts GEMINI_ACCESS_TOKEN as valid Gemini auth', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'access-token'
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  process.env.GEMINI_ACCESS_TOKEN = 'token-123'

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('accepts ADC credentials for Gemini auth', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'adc'
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN

  await expect(
    getProviderValidationError(process.env, {
      resolveGeminiCredential: async () => ({
        kind: 'adc',
        credential: 'adc-token',
        projectId: 'adc-project',
      }),
    }),
  ).resolves.toBeNull()
})

test('still errors when no Gemini credential source is available', async () => {
  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_AUTH_MODE = 'access-token'
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.',
  )
})

test('openai missing key error includes recovery guidance and config locations', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.CODEX_ACCOUNT_ID

  const message = await getProviderValidationError(process.env)
  expect(message).toContain(
    'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
  expect(message).toContain(
    'set CLAUDE_CODE_USE_OPENAI=0 in your shell environment',
  )
  expect(message).toContain('Saved startup settings can come from')
  expect(message).toContain('.openclaude-profile.json')
})

test('startup provider validation allows interactive recovery', () => {
  expect(
    shouldExitForStartupProviderValidationError({
      args: [],
      stdoutIsTTY: true,
    }),
  ).toBe(false)
})

test('startup provider validation stays strict for non-interactive launches', () => {
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['-p', 'hello'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['--print', 'hello'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: [],
      stdoutIsTTY: false,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['--sdk-url', 'ws://127.0.0.1:3000'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
  expect(
    shouldExitForStartupProviderValidationError({
      args: ['--sdk-url=ws://127.0.0.1:3000'],
      stdoutIsTTY: true,
    }),
  ).toBe(true)
})
