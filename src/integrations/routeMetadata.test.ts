import { expect, test } from 'bun:test'

import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getRouteProviderTypeLabel,
  resolveActiveRouteIdFromEnv,
  resolveRouteCredentialValue,
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
  expect(getRouteCredentialEnvVars('custom')).toEqual([
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('openrouter')).toEqual([
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('deepseek')).toEqual([
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('hicap')).toEqual([
    'HICAP_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('venice')).toEqual([
    'VENICE_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('xiaomi-mimo')).toEqual([
    'MIMO_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
})

test('getRouteCredentialEnvVars omits the openai fallback for dedicatedCredentialsOnly routes', () => {
  expect(getRouteCredentialEnvVars('atlas-cloud')).toEqual([
    'ATLAS_CLOUD_API_KEY',
  ])
  expect(
    getRouteCredentialValue('atlas-cloud', {
      OPENAI_API_KEY: 'sk-openai-generic',
    }),
  ).toBeUndefined()
  expect(
    getRouteCredentialValue('atlas-cloud', {
      OPENAI_API_KEY: 'sk-openai-generic',
      ATLAS_CLOUD_API_KEY: 'atlas-key',
    }),
  ).toBe('atlas-key')
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

test('route credential discovery reads OPENAI_API_KEYS before singular fallback', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: 'sk-openai-a,sk-openai-b',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-a,sk-openai-b')
  expect(
    resolveRouteCredentialValue({
      baseUrl: 'https://api.openai.com/v1',
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEYS: 'sk-openai-a,sk-openai-b',
      },
    }),
  ).toBe('sk-openai-a,sk-openai-b')
})

test('route credential discovery ignores delimiter-only OPENAI_API_KEYS before singular fallback', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: ', ,',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-single')
})

test('route credential discovery ignores placeholder OpenAI credentials', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: 'SUA_CHAVE',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-single')
  expect(
    resolveRouteCredentialValue({
      baseUrl: 'https://api.openai.com/v1',
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEYS: 'SUA_CHAVE',
        OPENAI_API_KEY: 'SUA_CHAVE',
      },
    }),
  ).toBeUndefined()
})

test('route credential discovery ignores mixed placeholder OpenAI pools before singular fallback', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: 'sk-openai-a,SUA_CHAVE',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-single')
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

test('resolveActiveRouteIdFromEnv treats Anthropic-compatible MiniMax profile env as MiniMax', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      ANTHROPIC_API_KEY: 'minimax-key',
      ANTHROPIC_MODEL: 'MiniMax-M2.7',
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

test('resolveActiveRouteIdFromEnv lets explicit MiniMax model beat ambient OpenAI-compatible env', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'openai-key',
      XAI_API_KEY: 'xai-key',
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_MODEL: 'MiniMax-M2.7',
    }),
  ).toBe('minimax')
})

test('resolveActiveRouteIdFromEnv does not use MiniMax when OpenAI base conflicts', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'openai-key',
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'MiniMax-M2.7',
    }),
  ).toBe('openai')
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
  ['Hicap', 'https://api.hicap.ai/v1', 'claude-opus-4.8', 'hicap'],
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

test('resolveActiveRouteIdFromEnv does not infer MiniMax with pooled OpenAI credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_API_KEYS: 'openai-key-a,openai-key-b',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv infers Near AI with NEARAI_API_KEY and stale OPENAI_API_KEY', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      NEARAI_API_KEY: 'nearai-key',
      OPENAI_API_KEY: 'stale-openai-key',
    }),
  ).toBe('nearai')
})

test('resolveActiveRouteIdFromEnv does not infer Near AI when OPENAI_BASE_URL points elsewhere', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      NEARAI_API_KEY: 'nearai-key',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv does not infer Near AI with explicit provider flag', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      NEARAI_API_KEY: 'nearai-key',
      OPENAI_API_KEY: 'openai-key',
      CLAUDE_CODE_USE_GEMINI: '1',
    }),
  ).toBe('gemini')
})
