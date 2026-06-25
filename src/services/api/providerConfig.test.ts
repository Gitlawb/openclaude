import { expect, test } from 'bun:test'

import { resolveProviderRequest } from './providerConfig.js'

test('resolveProviderRequest strips GLM model-query suffixes from API model value', () => {
  const request = resolveProviderRequest({
    model: 'glm-5.2?reasoning=high',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    processEnv: {},
  })

  expect(request.requestedModel).toBe('glm-5.2?reasoning=high')
  expect(request.resolvedModel).toBe('glm-5.2')
  expect(request.reasoning).toEqual({ effort: 'high' })
})

test('resolveProviderRequest exposes model-query thinking defaults', () => {
  const request = resolveProviderRequest({
    model: 'glm-5.2?thinking=disabled',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    processEnv: {},
  })

  expect(request.resolvedModel).toBe('glm-5.2')
  expect(request.thinking).toEqual({ type: 'disabled' })
})

test('resolveProviderRequest maps explicit route catalog aliases to API model ids', () => {
  const request = resolveProviderRequest({
    model: 'glm-5.2?reasoning=high',
    baseUrl: 'https://api.atlascloud.ai/v1',
    processEnv: {},
  })

  expect(request.requestedModel).toBe('glm-5.2?reasoning=high')
  expect(request.resolvedModel).toBe('zai-org/glm-5.2')
  expect(request.reasoning).toEqual({ effort: 'high' })
})

test('resolveProviderRequest maps explicit Atlas coding aliases without ambiguity', () => {
  expect(resolveProviderRequest({
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://api.atlascloud.ai/v1',
    processEnv: {},
  }).resolvedModel).toBe('anthropic/claude-sonnet-4.6')

  expect(resolveProviderRequest({
    model: 'claude-sonnet-4-6-coding',
    baseUrl: 'https://api.atlascloud.ai/v1',
    processEnv: {},
  }).resolvedModel).toBe('anthropic/claude-sonnet-4.6-coding')

  expect(resolveProviderRequest({
    model: 'deepseek-ai/deepseek-v3.2',
    baseUrl: 'https://api.atlascloud.ai/v1',
    processEnv: {},
  }).resolvedModel).toBe('deepseek-ai/deepseek-v3.2')
})

test('resolveProviderRequest leaves OpenRouter routing untouched without explicit aliases', () => {
  const request = resolveProviderRequest({
    model: 'gpt-5-mini',
    baseUrl: 'https://openrouter.ai/api/v1',
    processEnv: {},
  })

  expect(request.resolvedModel).toBe('gpt-5-mini')
  expect(request.baseUrl).toBe('https://openrouter.ai/api/v1')
})

test('resolveProviderRequest maps Hicap discovered GLM aliases to static model ids', () => {
  const request = resolveProviderRequest({
    model: 'zai-org/GLM-5.2',
    baseUrl: 'https://api.hicap.ai/v1',
    processEnv: {},
  })

  expect(request.requestedModel).toBe('zai-org/GLM-5.2')
  expect(request.resolvedModel).toBe('glm-5.2')
  expect(request.baseUrl).toBe('https://api.hicap.ai/v1')
})

test('resolveProviderRequest canonicalizes Hicap catalog model casing', () => {
  const request = resolveProviderRequest({
    model: 'GLM-5.2',
    baseUrl: 'https://api.hicap.ai/v1',
    processEnv: {},
  })

  expect(request.requestedModel).toBe('GLM-5.2')
  expect(request.resolvedModel).toBe('glm-5.2')
  expect(request.baseUrl).toBe('https://api.hicap.ai/v1')
})

test('resolveProviderRequest leaves Hicap routing untouched without explicit aliases', () => {
  const request = resolveProviderRequest({
    model: 'claude-opus-4-7',
    baseUrl: 'https://api.hicap.ai/v1',
    processEnv: {},
  })

  expect(request.resolvedModel).toBe('claude-opus-4-7')
  expect(request.baseUrl).toBe('https://api.hicap.ai/v1')
})
