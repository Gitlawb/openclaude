import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type {
  AnthropicProxyDescriptor,
  GatewayDescriptor,
  ModelDescriptor,
  VendorDescriptor,
} from '../descriptors.js'
import { ensureIntegrationsLoaded } from '../index.js'
import {
  _clearRegistryForTesting,
  registerAnthropicProxy,
  registerGateway,
  registerModel,
  registerVendor,
} from '../registry.js'
import {
  findRouteCatalogEntry,
  getRouteCatalogEntries,
  getRouteModelCatalog,
  resolveRouteCatalogEntry,
  resolveRouteCatalogModelMetadata,
} from './catalog.js'

beforeEach(() => {
  _clearRegistryForTesting()
})

afterAll(() => {
  _clearRegistryForTesting()
  ensureIntegrationsLoaded()
})

function makeVendor(
  id: string,
  overrides?: Partial<VendorDescriptor>,
): VendorDescriptor {
  return {
    id,
    label: id,
    classification: 'openai-compatible',
    defaultBaseUrl: 'https://example.com/v1',
    defaultModel: 'model-a',
    setup: { requiresAuth: true, authMode: 'api-key' },
    transportConfig: { kind: 'openai-compatible' },
    ...overrides,
  }
}

function makeGateway(
  id: string,
  overrides?: Partial<GatewayDescriptor>,
): GatewayDescriptor {
  return {
    id,
    label: id,
    setup: { requiresAuth: true, authMode: 'api-key' },
    transportConfig: { kind: 'openai-compatible' },
    ...overrides,
  }
}

function makeAnthropicProxy(
  id: string,
  overrides?: Partial<AnthropicProxyDescriptor>,
): AnthropicProxyDescriptor {
  return {
    id,
    label: id,
    classification: 'anthropic-proxy',
    defaultBaseUrl: 'https://proxy.example.com',
    defaultModel: 'claude-sonnet',
    setup: { requiresAuth: true, authMode: 'api-key' },
    envVarConfig: {
      authTokenEnvVar: 'PROXY_API_KEY',
      baseUrlEnvVar: 'PROXY_BASE_URL',
    },
    capabilities: {},
    transportConfig: { kind: 'anthropic-proxy' },
    ...overrides,
  }
}

function makeModel(
  id: string,
  overrides?: Partial<ModelDescriptor>,
): ModelDescriptor {
  return {
    id,
    label: id,
    vendorId: 'openai',
    classification: ['chat'],
    defaultModel: id,
    capabilities: {},
    ...overrides,
  }
}

describe('route-scoped model catalog helpers', () => {
  test('reads catalog data from the route descriptor', () => {
    registerVendor(
      makeVendor('acme', {
        catalog: {
          source: 'static',
          models: [{ id: 'acme-model', apiName: 'acme/model' }],
        },
      }),
    )

    expect(getRouteModelCatalog('acme')?.source).toBe('static')
    expect(getRouteCatalogEntries('acme')).toEqual([
      { id: 'acme-model', apiName: 'acme/model' },
    ])
  })

  test('finds entries by route-local id and apiName', () => {
    registerGateway(
      makeGateway('gw-a', {
        catalog: {
          source: 'static',
          models: [{ id: 'entry-a', apiName: 'provider/model-a' }],
        },
      }),
    )

    expect(findRouteCatalogEntry('gw-a', 'entry-a')?.apiName).toBe(
      'provider/model-a',
    )
    expect(findRouteCatalogEntry('gw-a', 'provider/model-a')?.id).toBe(
      'entry-a',
    )
  })

  test('keeps duplicate model names isolated across routes', () => {
    registerGateway(
      makeGateway('route-a', {
        catalog: {
          source: 'static',
          models: [{ id: 'shared-id', apiName: 'same-api-name' }],
        },
      }),
    )
    registerGateway(
      makeGateway('route-b', {
        catalog: {
          source: 'static',
          models: [{ id: 'shared-id', apiName: 'same-api-name' }],
        },
      }),
    )

    expect(resolveRouteCatalogEntry('route-a', 'same-api-name')?.routeId).toBe(
      'route-a',
    )
    expect(resolveRouteCatalogEntry('route-b', 'same-api-name')?.routeId).toBe(
      'route-b',
    )
    expect(findRouteCatalogEntry('missing-route', 'same-api-name')).toBeUndefined()
  })

  test('resolves modelDescriptorId and shared default model names within one route', () => {
    registerModel(
      makeModel('shared-model', {
        label: 'Shared Model',
        defaultModel: 'vendor-default-name',
        capabilities: { supportsReasoning: true },
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
      }),
    )
    registerVendor(
      makeVendor('vendor-a', {
        catalog: {
          source: 'static',
          models: [
            {
              id: 'route-model',
              apiName: 'vendor-a-model',
              modelDescriptorId: 'shared-model',
            },
          ],
        },
      }),
    )

    const entry = resolveRouteCatalogEntry('vendor-a', 'vendor-default-name')

    expect(entry?.id).toBe('route-model')
    expect(entry?.modelDescriptor?.id).toBe('shared-model')
  })

  test('uses providerModelMap only for the requested route', () => {
    registerModel(
      makeModel('shared-model', {
        defaultModel: 'global-name',
        providerModelMap: {
          'route-a': 'route-a-name',
          'route-b': 'route-b-name',
        },
      }),
    )
    registerGateway(
      makeGateway('route-a', {
        catalog: {
          source: 'static',
          models: [
            {
              id: 'route-a-entry',
              apiName: 'route-a-api',
              modelDescriptorId: 'shared-model',
            },
          ],
        },
      }),
    )
    registerGateway(
      makeGateway('route-b', {
        catalog: {
          source: 'static',
          models: [
            {
              id: 'route-b-entry',
              apiName: 'route-b-api',
              modelDescriptorId: 'shared-model',
            },
          ],
        },
      }),
    )

    expect(findRouteCatalogEntry('route-a', 'route-a-name')?.id).toBe(
      'route-a-entry',
    )
    expect(findRouteCatalogEntry('route-a', 'route-b-name')).toBeUndefined()
    expect(findRouteCatalogEntry('route-b', 'route-b-name')?.id).toBe(
      'route-b-entry',
    )
  })

  test('merges shared model metadata with route entry overrides', () => {
    registerModel(
      makeModel('shared-model', {
        label: 'Shared Label',
        defaultModel: 'shared-model',
        capabilities: {
          supportsStreaming: true,
          supportsReasoning: false,
        },
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      }),
    )
    registerGateway(
      makeGateway('route-a', {
        catalog: {
          source: 'static',
          models: [
            {
              id: 'route-model',
              apiName: 'route-model-api',
              label: 'Route Label',
              modelDescriptorId: 'shared-model',
              capabilities: { supportsReasoning: true },
              contextWindow: 128_000,
              transportOverrides: {
                openaiShim: {
                  maxTokensField: 'max_tokens',
                  removeBodyFields: ['store'],
                },
              },
            },
          ],
        },
      }),
    )

    const metadata = resolveRouteCatalogModelMetadata('route-a', 'route-model-api')

    expect(metadata).toMatchObject({
      routeId: 'route-a',
      id: 'route-model',
      apiName: 'route-model-api',
      label: 'Route Label',
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      capabilities: {
        supportsStreaming: true,
        supportsReasoning: true,
      },
      transportOverrides: {
        openaiShim: {
          maxTokensField: 'max_tokens',
          removeBodyFields: ['store'],
        },
      },
    })
  })

  test('supports anthropic proxy route catalogs without changing transport ownership', () => {
    registerAnthropicProxy(
      makeAnthropicProxy('proxy-a', {
        catalog: {
          source: 'static',
          models: [
            {
              id: 'proxy-claude',
              apiName: 'proxy-claude-api',
              capabilities: { supportsVision: true },
            },
          ],
        },
      }),
    )

    const metadata = resolveRouteCatalogModelMetadata('proxy-a', 'proxy-claude-api')

    expect(metadata?.routeId).toBe('proxy-a')
    expect(metadata?.capabilities.supportsVision).toBe(true)
  })
})
