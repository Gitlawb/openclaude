import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  getModelEndpoint,
  getModelMetadata,
  getAllProviderCatalogs,
  getProviderCatalog,
  resolveModelAlias,
} from './catalog.js'
import type { ProviderCatalog } from './types.js'

afterEach(() => {
  mock.restore()
})

function fixtureCatalog(
  provider: string,
  overrides: Partial<ProviderCatalog> = {},
): ProviderCatalog {
  return {
    schemaVersion: 1,
    provider,
    label: provider,
    baseUrl: `https://${provider}.example.com/v1`,
    endpoints: {
      chatCompletions: {
        path: '/chat/completions',
        protocol: 'openai-chat-completions',
      },
    },
    defaults: {
      endpoint: 'chatCompletions',
      request: {
        maxTokensField: 'max_tokens',
        removeBodyFields: ['from-provider-defaults'],
      },
    },
    models: {
      'shared-model': {
        label: 'Shared Model',
      },
    },
    ...overrides,
  }
}

async function importCatalogWithProviders(
  providers: ProviderCatalog[],
  cacheKey: string,
) {
  mock.module('./providerCatalogs.js', () => ({
    PROVIDER_CATALOGS: providers,
  }))

  return import(`./catalog.js?${cacheKey}`)
}

describe('provider model catalog loader', () => {
  test('loads statically imported provider catalogs', () => {
    expect(getProviderCatalog('opencode-go')?.label).toBe('OpenCode Go')
  })

  test('resolves aliases within a provider catalog', () => {
    expect(resolveModelAlias('opencode-go/kimi-k2.6', 'opencode-go')).toBe(
      'kimi-k2.6',
    )
  })

  test('merges defaults, templates, and model entries deterministically', () => {
    const metadata = getModelMetadata('kimi-k2.6', 'opencode-go')
    expect(metadata?.provider).toBe('opencode-go')
    expect(metadata?.id).toBe('kimi-k2.6')
    expect(metadata?.apiName).toBe('kimi-k2.6')
    expect(metadata?.endpoint).toBe('chatCompletions')
    expect(metadata?.limits?.contextWindow).toBe(256000)
    expect(metadata?.capabilities?.reasoning).toBe(true)
  })

  test('resolves per-model mixed endpoints', () => {
    expect(getModelEndpoint('kimi-k2.6', 'opencode-go')?.url).toBe(
      'https://opencode.ai/zen/go/v1/chat/completions',
    )
    expect(getModelEndpoint('minimax-m2.7', 'opencode-go')?.url).toBe(
      'https://opencode.ai/zen/go/v1/messages',
    )
  })

  test('merges shared inherited templates for each sibling branch', async () => {
    const { getModelMetadata } = await importCatalogWithProviders(
      [
        fixtureCatalog('fixture', {
          templates: {
            base: {
              limits: { contextWindow: 64000 },
              capabilities: { promptCaching: true },
            },
            left: {
              extends: ['base'],
              limits: { contextWindow: 128000 },
              capabilities: { reasoning: true },
            },
            right: {
              extends: ['base'],
              limits: { maxInputTokens: 32000 },
              capabilities: { vision: true },
            },
            parent: {
              extends: ['left', 'right'],
            },
          },
          models: {
            'shared-template-model': {
              extends: ['parent'],
              label: 'Shared Template Model',
            },
          },
        }),
      ],
      'shared-template-inheritance',
    )

    const metadata = getModelMetadata('shared-template-model', 'fixture')
    expect(metadata?.limits?.contextWindow).toBe(64000)
    expect(metadata?.limits?.maxInputTokens).toBe(32000)
    expect(metadata?.capabilities?.promptCaching).toBe(true)
    expect(metadata?.capabilities?.reasoning).toBe(true)
    expect(metadata?.capabilities?.vision).toBe(true)
  })

  test('rejects template inheritance cycles at load time', async () => {
    await expect(
      importCatalogWithProviders(
        [
          fixtureCatalog('cycle-fixture', {
            templates: {
              first: { extends: ['second'] },
              second: { extends: ['first'] },
            },
            models: {
              'cycle-model': {
                extends: ['first'],
                label: 'Cycle Model',
              },
            },
          }),
        ],
        'template-cycle',
      ),
    ).rejects.toThrow(
      'Invalid model catalog "cycle-fixture": template inheritance cycle detected: first -> second -> first',
    )
  })

  test('throws when omitted-provider model lookup is ambiguous', async () => {
    const { getModelMetadata } = await importCatalogWithProviders(
      [fixtureCatalog('first-provider'), fixtureCatalog('second-provider')],
      'ambiguous-model-lookup',
    )

    expect(() => getModelMetadata('shared-model')).toThrow(
      'Ambiguous model lookup "shared-model": matched first-provider/shared-model, second-provider/shared-model',
    )
  })

  test('returns mutation-safe model metadata', () => {
    const metadata = getModelMetadata('minimax-m2.7', 'opencode-go')
    expect(metadata?.limits?.contextWindow).toBe(128000)

    if (metadata?.limits) {
      metadata.limits.contextWindow = 1
    }

    expect(getModelMetadata('minimax-m2.7', 'opencode-go')?.limits?.contextWindow)
      .toBe(128000)
  })

  test('returns frozen provider catalogs', () => {
    const provider = getProviderCatalog('opencode-go')
    expect(Object.isFrozen(provider)).toBe(true)
    expect(Object.isFrozen(provider?.models)).toBe(true)
    expect(Object.isFrozen(getAllProviderCatalogs())).toBe(false)
  })

  test('merges request settings with endpoint, provider, then model precedence', async () => {
    const { getModelEndpoint } = await importCatalogWithProviders(
      [
        fixtureCatalog('request-fixture', {
          endpoints: {
            chatCompletions: {
              path: '/chat/completions',
              protocol: 'openai-chat-completions',
              request: {
                maxTokensField: 'max_completion_tokens',
                preserveReasoningContent: false,
                removeBodyFields: ['from-endpoint'],
              },
            },
          },
          defaults: {
            endpoint: 'chatCompletions',
            request: {
              maxTokensField: 'max_tokens',
              requireReasoningContentOnAssistantMessages: true,
              removeBodyFields: ['from-provider-defaults'],
            },
          },
          models: {
            'request-model': {
              label: 'Request Model',
              request: {
                maxTokensField: 'max_completion_tokens',
                removeBodyFields: ['from-model'],
              },
            },
          },
        }),
      ],
      'request-merge-precedence',
    )

    expect(getModelEndpoint('request-model', 'request-fixture')?.request).toEqual({
      maxTokensField: 'max_completion_tokens',
      preserveReasoningContent: false,
      requireReasoningContentOnAssistantMessages: true,
      removeBodyFields: ['from-model'],
    })
  })
})
