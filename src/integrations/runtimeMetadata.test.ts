import { expect, test } from 'bun:test'
import { getModelEndpoint } from './modelCatalog/catalog.js'
import {
  resolveCatalogProviderIdForRuntimeRequest,
  resolveOpenAIShimRuntimeContext,
} from './runtimeMetadata.js'

test('catalog resolves mixed endpoint profiles for OpenCode Go fixture', () => {
  expect(getModelEndpoint('kimi-k2.6', 'opencode-go')?.protocol).toBe(
    'openai-chat-completions',
  )
  expect(getModelEndpoint('minimax-m2.7', 'opencode-go')?.protocol).toBe(
    'anthropic-messages',
  )
})

test('runtime request metadata resolves catalog-only providers by base URL', () => {
  const processEnv = {
    CLAUDE_CODE_USE_OPENAI: '1',
  }
  const baseUrl = 'https://opencode.ai/zen/go/v1'

  expect(
    resolveCatalogProviderIdForRuntimeRequest('custom', {
      ...processEnv,
      OPENAI_BASE_URL: baseUrl,
    }),
  ).toBe('opencode-go')

  const context = resolveOpenAIShimRuntimeContext({
    processEnv,
    baseUrl,
    model: 'kimi-k2.6',
  })

  expect(context.routeId).toBe('custom')
  expect(context.descriptor?.id).toBe('custom')
  expect(context.openaiShimConfig.maxTokensField).toBe('max_tokens')
})

test('runtime request metadata ignores ambiguous catalog models for generic custom routes', () => {
  const processEnv = {
    CLAUDE_CODE_USE_OPENAI: '1',
  }
  const baseUrl = 'https://example.com/v1'

  expect(
    resolveCatalogProviderIdForRuntimeRequest('custom', {
      ...processEnv,
      OPENAI_BASE_URL: baseUrl,
    }),
  ).toBeUndefined()

  const gptContext = resolveOpenAIShimRuntimeContext({
    processEnv,
    baseUrl,
    model: 'gpt-4o',
  })

  expect(gptContext.routeId).toBe('custom')
  expect(gptContext.openaiShimConfig.maxTokensField).toBeUndefined()

  expect(() =>
    resolveOpenAIShimRuntimeContext({
      processEnv,
      baseUrl,
      model: 'kimi-k2.6',
    }),
  ).not.toThrow()
})
