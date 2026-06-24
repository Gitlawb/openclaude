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
