import { expect, test } from 'bun:test'

import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  getRouteProviderTypeLabel,
  resolveActiveRouteIdFromEnv,
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
  expect(getRouteCredentialEnvVars('custom')).toEqual(['OPENAI_API_KEY'])
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

test('resolveActiveRouteIdFromEnv treats MiniMax credential-only env as MiniMax', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
    }),
  ).toBe('minimax')
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

test('resolveActiveRouteIdFromEnv does not infer MiniMax with OpenAI credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_API_KEY: 'openai-key',
    }),
  ).toBe('anthropic')
})
