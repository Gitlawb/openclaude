import { afterEach, expect, test } from 'bun:test'

import {
  getProviderValidationError,
  shouldExitForStartupProviderValidationError,
} from './providerValidation.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  NVIDIA_NIM: process.env.NVIDIA_NIM,
  BNKR_API_KEY: process.env.BNKR_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
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
  restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
  restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
  restoreEnv('CLAUDE_CODE_USE_MISTRAL', originalEnv.CLAUDE_CODE_USE_MISTRAL)
  restoreEnv('MISTRAL_API_KEY', originalEnv.MISTRAL_API_KEY)
  restoreEnv('MINIMAX_API_KEY', originalEnv.MINIMAX_API_KEY)
  restoreEnv('NVIDIA_API_KEY', originalEnv.NVIDIA_API_KEY)
  restoreEnv('NVIDIA_NIM', originalEnv.NVIDIA_NIM)
  restoreEnv('BNKR_API_KEY', originalEnv.BNKR_API_KEY)
  restoreEnv('OPENROUTER_API_KEY', originalEnv.OPENROUTER_API_KEY)
  restoreEnv('DEEPSEEK_API_KEY', originalEnv.DEEPSEEK_API_KEY)
  restoreEnv('MOONSHOT_API_KEY', originalEnv.MOONSHOT_API_KEY)
  restoreEnv('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN)
  restoreEnv('GH_TOKEN', originalEnv.GH_TOKEN)
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

test('mistral validation is descriptor-backed and requires MISTRAL_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  delete process.env.MISTRAL_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'MISTRAL_API_KEY is required when CLAUDE_CODE_USE_MISTRAL=1.',
  )
})

test('mistral validation still wins when stale openai mode is also set', async () => {
  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.MISTRAL_API_KEY
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'MISTRAL_API_KEY is required when CLAUDE_CODE_USE_MISTRAL=1.',
  )
})

test('minimax validation accepts MINIMAX_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.io/v1'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('minimax validation accepts MINIMAX_API_KEY on minimax chat host alias', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.minimax.chat/v1'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('nvidia nim validation accepts NVIDIA_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('nvidia nim validation accepts NVIDIA_API_KEY for custom NIM endpoints when NVIDIA_NIM is set', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.NVIDIA_NIM = '1'
  process.env.OPENAI_BASE_URL = 'https://nim.example.com/v1'
  process.env.NVIDIA_API_KEY = 'nvidia-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('bankr validation accepts BNKR_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://llm.bankr.bot/v1'
  process.env.BNKR_API_KEY = 'bankr-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('openai validation does not accept unrelated minimax credentials', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.MINIMAX_API_KEY = 'minimax-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toContain(
    'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
})

test('openrouter validation accepts OPENROUTER_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENROUTER_API_KEY = 'or-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('deepseek validation accepts DEEPSEEK_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.DEEPSEEK_API_KEY = 'deepseek-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('moonshot validation accepts MOONSHOT_API_KEY without OPENAI_API_KEY', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.moonshot.ai/v1'
  process.env.MOONSHOT_API_KEY = 'moonshot-live-key'
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toBeNull()
})

test('github validation stays descriptor-selected and reports missing auth', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  await expect(getProviderValidationError(process.env)).resolves.toBe(
    'GitHub Copilot authentication required.\n' +
      'Run /onboard-github in the CLI to sign in with your GitHub account.\n' +
      'This will store your OAuth token securely and enable Copilot models.',
  )
})

test('github validation is skipped when openai mode is also active', async () => {
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  delete process.env.OPENAI_API_KEY

  await expect(getProviderValidationError(process.env)).resolves.toContain(
    'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
  )
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
