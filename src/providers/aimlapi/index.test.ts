import { describe, expect, test } from 'bun:test'
import {
  AIMLAPI_ATTRIBUTION_HEADERS,
  AIMLAPI_DEFAULT_BASE_URL,
  AIMLAPI_DEFAULT_MODEL,
  AIMLAPI_LABEL,
  AIMLAPI_PROVIDER_ID,
  AIMLAPI_PROVIDER_PRESET_OPTION,
  getAimlapiApiKey,
  getAimlapiAttributionHeaders,
  getAimlapiOpenAICompatibleApiKey,
  getAimlapiPresetDefaults,
  hasAimlapiApiKey,
  isAimlapiBaseUrl,
  mapAimlapiModelCatalog,
  syncAimlapiOpenAIEnv,
} from './index.js'

describe('AI/ML API provider module', () => {
  test('detects only api.aimlapi.com base URLs', () => {
    expect(isAimlapiBaseUrl('https://api.aimlapi.com/v1')).toBe(true)
    expect(isAimlapiBaseUrl('https://api.aimlapi.com/v1/')).toBe(true)
    expect(isAimlapiBaseUrl('https://example.com/api.aimlapi.com/v1')).toBe(false)
    expect(isAimlapiBaseUrl('not a url')).toBe(false)
    expect(isAimlapiBaseUrl(undefined)).toBe(false)
  })

  test('exposes preset defaults and picker option metadata', () => {
    expect(getAimlapiPresetDefaults({
      AIMLAPI_API_KEY: 'aiml-key',
      OPENAI_API_KEY: 'openai-key',
    })).toEqual({
      provider: 'openai',
      name: AIMLAPI_LABEL,
      baseUrl: AIMLAPI_DEFAULT_BASE_URL,
      model: AIMLAPI_DEFAULT_MODEL,
      apiKey: 'aiml-key',
      requiresApiKey: true,
    })

    expect(AIMLAPI_PROVIDER_PRESET_OPTION).toEqual({
      value: AIMLAPI_PROVIDER_ID,
      label: AIMLAPI_LABEL,
      description: 'AI/ML API OpenAI-compatible endpoint',
    })
  })

  test('resolves provider-specific auth without affecting other base URLs', () => {
    const env = {
      AIMLAPI_API_KEY: 'aiml-key',
      OPENAI_API_KEY: 'openai-key',
    }

    expect(getAimlapiApiKey(env)).toBe('aiml-key')
    expect(getAimlapiApiKey({ OPENAI_API_KEY: 'openai-key' })).toBe('openai-key')
    expect(getAimlapiOpenAICompatibleApiKey(
      'https://api.aimlapi.com/v1',
      env,
    )).toBe('aiml-key')
    expect(getAimlapiOpenAICompatibleApiKey(
      'https://openrouter.ai/api/v1',
      env,
    )).toBeUndefined()
    expect(hasAimlapiApiKey('https://api.aimlapi.com/v1', env)).toBe(true)
  })

  test('adds attribution headers only for AI/ML API', () => {
    expect(getAimlapiAttributionHeaders('https://api.aimlapi.com/v1')).toEqual(
      AIMLAPI_ATTRIBUTION_HEADERS,
    )
    expect(getAimlapiAttributionHeaders('https://api.openai.com/v1')).toEqual({})
  })

  test('syncs AIMLAPI_API_KEY into OPENAI_API_KEY only for AI/ML API env', () => {
    const aimlEnv = {
      OPENAI_BASE_URL: 'https://api.aimlapi.com/v1',
      AIMLAPI_API_KEY: 'aiml-key',
    }
    syncAimlapiOpenAIEnv(aimlEnv)
    expect(aimlEnv.OPENAI_API_KEY).toBe('aiml-key')

    const existingOpenAIEnv = {
      OPENAI_BASE_URL: 'https://api.aimlapi.com/v1',
      AIMLAPI_API_KEY: 'aiml-key',
      OPENAI_API_KEY: 'openai-key',
    }
    syncAimlapiOpenAIEnv(existingOpenAIEnv)
    expect(existingOpenAIEnv.OPENAI_API_KEY).toBe('openai-key')

    const otherEnv = {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      AIMLAPI_API_KEY: 'aiml-key',
    }
    syncAimlapiOpenAIEnv(otherEnv)
    expect(otherEnv.OPENAI_API_KEY).toBeUndefined()
  })

  test('maps chat-completions models with metadata and deduplication', () => {
    expect(mapAimlapiModelCatalog({
      data: [
        {
          id: 'gpt-4o',
          type: 'openai/chat-completions',
          info: {
            name: 'GPT 4o',
            developer: 'OpenAI',
            contextLength: 128000,
          },
        },
        {
          id: 'gpt-4o',
          type: 'openai/chat-completions',
          info: { name: 'Duplicate GPT 4o' },
        },
        {
          id: 'image-model',
          type: 'openai/images',
        },
        {
          id: 'deepseek-chat',
          type: 'openai/chat-completions',
          info: {
            name: 'DeepSeek Chat',
            developer: 'DeepSeek',
          },
        },
      ],
    })).toEqual([
      {
        value: 'gpt-4o',
        label: 'GPT 4o',
        description: 'OpenAI - 128000 context',
      },
      {
        value: 'deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'DeepSeek',
      },
    ])
  })
})
