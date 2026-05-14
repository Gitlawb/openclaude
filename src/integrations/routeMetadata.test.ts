import { expect, test } from 'bun:test'

import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getRouteProviderTypeLabel,
  resolveActiveRouteIdFromEnv,
  resolveRouteIdFromBaseUrl,
} from './routeMetadata.js'

test('getRouteProviderTypeLabel uses descriptor transport kinds for provider labels', () => {
  expect(getRouteProviderTypeLabel('anthropic')).toBe('Anthropic native API')
  expect(getRouteProviderTypeLabel('gemini')).toBe('Gemini API')
  expect(getRouteProviderTypeLabel('bedrock')).toBe(
    'AWS Bedrock Claude API',
  )
  expect(getRouteProviderTypeLabel('vertex')).toBe(
    'Google Vertex Claude API',
  )
  expect(getRouteProviderTypeLabel('openrouter')).toBe(
    'OpenAI-compatible API',
  )
  expect(getRouteProviderTypeLabel('ollama')).toBe('OpenAI-compatible API')
})

test('getRouteProviderTypeLabel falls back safely for unknown routes', () => {
  expect(getRouteProviderTypeLabel('missing-route')).toBe(
    'OpenAI-compatible API',
  )
})

test('getRouteCredentialEnvVars keeps descriptor env vars and openai fallback for openai-compatible routes', () => {
  expect(getRouteCredentialEnvVars('openrouter')).toEqual([
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('deepseek')).toEqual([
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('hicap')).toEqual([
    'HICAP_API_KEY',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('venice')).toEqual([
    'VENICE_API_KEY',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('xiaomi-mimo')).toEqual([
    'MIMO_API_KEY',
    'OPENAI_API_KEY',
  ])
})

test('getRouteCredentialValue reads the first configured route credential', () => {
  expect(
    getRouteCredentialValue('openrouter', {
      OPENROUTER_API_KEY: 'or-key',
    }),
  ).toBe('or-key')
  expect(
    getRouteCredentialValue('deepseek', {
      OPENAI_API_KEY: 'sk-openai-fallback',
    }),
  ).toBe('sk-openai-fallback')
})

test('Venice route metadata uses official OpenAI-compatible defaults', () => {
  expect(getRouteDefaultBaseUrl('venice')).toBe('https://api.venice.ai/api/v1')
  expect(getRouteDefaultModel('venice')).toBe('venice-uncensored')
  expect(resolveRouteIdFromBaseUrl('https://api.venice.ai/api/v1')).toBe('venice')
  expect(resolveRouteIdFromBaseUrl('https://api.venice.ai/api/v1/chat/completions')).toBe('venice')
})

test('Xiaomi MiMo route metadata uses official OpenAI-compatible defaults', () => {
  expect(getRouteDefaultBaseUrl('xiaomi-mimo')).toBe('https://api.xiaomimimo.com/v1')
  expect(getRouteDefaultModel('xiaomi-mimo')).toBe('mimo-v2.5-pro')
  expect(resolveRouteIdFromBaseUrl('https://api.xiaomimimo.com/v1')).toBe('xiaomi-mimo')
  expect(resolveRouteIdFromBaseUrl('https://api.xiaomimimo.com/v1/chat/completions')).toBe('xiaomi-mimo')
  expect(resolveRouteIdFromBaseUrl('https://api.mimo-v2.com/v1')).toBe('xiaomi-mimo')
})

test('resolveActiveRouteIdFromEnv treats Xiaomi MiMo credential-only env as Xiaomi MiMo', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MIMO_API_KEY: 'mimo-key',
    }),
  ).toBe('xiaomi-mimo')
})

test('resolveActiveRouteIdFromEnv treats MiniMax credential-only env as MiniMax', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
    }),
  ).toBe('minimax')
})

test('resolveActiveRouteIdFromEnv treats Venice credential-only env as Venice', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      VENICE_API_KEY: 'venice-key',
    }),
  ).toBe('venice')
})
test('resolveActiveRouteIdFromEnv treats xAI credential-only env as xAI', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      XAI_API_KEY: 'xai-key',
    }),
  ).toBe('xai')
})

test('resolveActiveRouteIdFromEnv prefers xAI when env-only keys compete', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      XAI_API_KEY: 'xai-key',
      MINIMAX_API_KEY: 'minimax-key',
    }),
  ).toBe('xai')
})

test('resolveActiveRouteIdFromEnv keeps xAI primary base over stale API base', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      XAI_API_KEY: 'xai-key',
      OPENAI_BASE_URL: 'https://api.x.ai/v1',
      OPENAI_API_BASE: 'https://api.openai.com/v1',
    }),
  ).toBe('xai')
})

test('resolveActiveRouteIdFromEnv keeps MiniMax primary base over stale API base', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_BASE_URL: 'https://api.minimax.chat/v1',
      OPENAI_API_BASE: 'https://api.openai.com/v1',
    }),
  ).toBe('minimax')
})

test.each([
  ['MiniMax', 'https://api.minimax.io/v1', 'MiniMax-M2.7', 'minimax'],
  ['xAI', 'https://api.x.ai/v1', 'grok-4.3', 'xai'],
  ['NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', 'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia-nim'],
  ['OpenRouter', 'https://openrouter.ai/api/v1', 'openai/gpt-5-mini', 'openrouter'],
  ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-v4-pro', 'deepseek'],
  ['Hicap', 'https://api.hicap.ai/v1', 'claude-opus-4.7', 'hicap'],
  ['Xiaomi MiMo', 'https://api.xiaomimimo.com/v1', 'mimo-v2.5-pro', 'xiaomi-mimo'],
  ['Venice', 'https://api.venice.ai/api/v1', 'venice-uncensored', 'venice'],
])(
  'resolveActiveRouteIdFromEnv refines generic OpenAI profile by %s base URL',
  (_label, baseUrl, model, expectedRouteId) => {
    expect(
      resolveActiveRouteIdFromEnv(
        {
          CLAUDE_CODE_USE_OPENAI: '1',
          CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
          OPENAI_BASE_URL: baseUrl,
          OPENAI_MODEL: model,
        },
        { activeProfileProvider: 'openai' },
      ),
    ).toBe(expectedRouteId)
  },
)

test('resolveActiveRouteIdFromEnv does not infer MiniMax with OpenAI credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_API_KEY: 'openai-key',
    }),
  ).toBe('anthropic')
})
