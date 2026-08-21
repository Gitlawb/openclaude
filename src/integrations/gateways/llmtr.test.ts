import { expect, test } from 'bun:test'

import { routeForPreset } from '../compatibility.js'
import { getProviderPresetUiMetadata } from '../providerUiMetadata.js'
import {
  resolveActiveRouteIdFromEnv,
  resolveRouteCredentialValue,
} from '../routeMetadata.js'
import catalog, { mapLlmtrModel } from './llmtr.models.js'
import gateway from './llmtr.js'

test('LLMTR uses the standard OpenAI-compatible gateway contract', () => {
  expect(gateway.defaultBaseUrl).toBe('https://llmtr.com/v1')
  expect(gateway.defaultModel).toBe('deepseek/deepseek-v4-flash')
  expect(gateway.setup.credentialEnvVars).toEqual([
    'LLMTR_API_KEY',
    'OPENAI_API_KEY',
  ])
  expect(gateway.setup.dedicatedCredentialsOnly).not.toBe(true)
  expect(gateway.transportConfig).toEqual({
    kind: 'openai-compatible',
    openaiShim: {
      requiredApiFormat: 'chat_completions',
      supportsAuthHeaders: false,
      maxTokensField: 'max_tokens',
    },
  })
  expect(catalog.source).toBe('hybrid')
  expect(catalog.discovery?.requiresAuth).toBe(false)
})

test('LLMTR preset uses the existing generic profile path', () => {
  expect(routeForPreset('llmtr')).toEqual({
    vendorId: 'openai',
    gatewayId: 'llmtr',
    routeId: 'llmtr',
  })
  expect(
    getProviderPresetUiMetadata('llmtr', {
      LLMTR_API_KEY: 'llmtr-key',
      OPENAI_API_KEY: 'generic-key',
    }),
  ).toMatchObject({
    apiKey: 'llmtr-key',
    baseUrl: 'https://llmtr.com/v1',
    model: 'deepseek/deepseek-v4-flash',
    provider: 'llmtr',
    routeId: 'llmtr',
  })
})

test('LLMTR prefers its dedicated env key with generic OpenAI fallback', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://llmtr.com/v1',
      OPENAI_MODEL: 'deepseek/deepseek-v4-flash',
      LLMTR_API_KEY: 'dedicated-key',
    }),
  ).toBe('llmtr')

  expect(
    resolveRouteCredentialValue({
      routeId: 'llmtr',
      baseUrl: 'https://llmtr.com/v1',
      processEnv: {
        LLMTR_API_KEY: 'dedicated-key',
        OPENAI_API_KEY: 'generic-key',
      },
    }),
  ).toBe('dedicated-key')

  expect(
    resolveRouteCredentialValue({
      routeId: 'llmtr',
      baseUrl: 'https://llmtr.com/v1',
      processEnv: { OPENAI_API_KEY: 'generic-key' },
    }),
  ).toBe('generic-key')
})

test('LLMTR discovery keeps tool-capable Chat Completions models', () => {
  expect(
    mapLlmtrModel({
      id: 'example/chat-model',
      name: 'Chat Model',
      context_length: 131_072,
      top_provider: {
        max_completion_tokens: 32_768,
      },
      architecture: {
        input_modalities: ['text', 'image'],
      },
      reasoning: {},
      supported_parameters: ['tools', 'reasoning'],
      supported_operations: ['CHAT_COMPLETIONS'],
      supported_endpoints: ['/v1/chat/completions'],
    }),
  ).toEqual({
    id: 'example/chat-model',
    apiName: 'example/chat-model',
    label: 'Chat Model',
    capabilities: {
      supportsFunctionCalling: true,
      supportsVision: true,
      supportsReasoning: true,
    },
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
  })
})

test.each([
  ['Responses-only', ['RESPONSES'], ['/v1/responses'], ['tools']],
  ['no tools', ['CHAT_COMPLETIONS'], ['/v1/chat/completions'], []],
  ['wrong endpoint', ['CHAT_COMPLETIONS'], ['/v1/responses'], ['tools']],
])('LLMTR discovery rejects %s models', (_label, operations, endpoints, parameters) => {
  expect(
    mapLlmtrModel({
      id: 'example/incompatible',
      supported_operations: operations,
      supported_endpoints: endpoints,
      supported_parameters: parameters,
    }),
  ).toBeNull()
})

test('LLMTR curated models are a small tool-capable fallback catalog', () => {
  expect(catalog.models?.map(model => model.apiName)).toEqual([
    'deepseek/deepseek-v4-flash',
    'anthropic/claude-sonnet-4.6',
    'openai/gpt-5.4',
    'google/gemini-3.1-pro-preview',
    'deepseek/deepseek-v4-pro',
    'zai/glm-5.2',
  ])
})
