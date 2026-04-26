import { expect, test } from 'bun:test'

import { getRouteProviderTypeLabel } from './routeMetadata.js'

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
