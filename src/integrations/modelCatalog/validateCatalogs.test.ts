import { describe, expect, mock, test } from 'bun:test'
import { validateProviderCatalog } from './schema.js'
import type { ProviderCatalog } from './types.js'

const expectedProviders = [
  'anthropic',
  'atomic-chat',
  'azure-openai',
  'bankr',
  'bedrock',
  'codex',
  'custom',
  'dashscope-cn',
  'dashscope-intl',
  'deepseek',
  'gemini',
  'github',
  'github-copilot',
  'groq',
  'hicap',
  'kimi-code',
  'lmstudio',
  'minimax',
  'mistral',
  'moonshot',
  'nvidia-nim',
  'ollama',
  'openai',
  'opencode-go',
  'openrouter',
  'together',
  'vertex',
  'xai',
  'zai',
]

describe('provider catalog inventory', () => {
  function joinUrl(baseUrl: string | undefined, path: string): string | undefined {
    if (!baseUrl) {
      return undefined
    }

    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  }

  async function loadProviderCatalogs(): Promise<ProviderCatalog[]> {
    mock.restore()
    const module = await import(
      `./providerCatalogs.js?validateCatalogs=${Date.now()}-${Math.random()}`
    )
    return module.PROVIDER_CATALOGS
  }

  test('loads every expected provider catalog', async () => {
    const providerCatalogs = await loadProviderCatalogs()

    expect(providerCatalogs.map(catalog => catalog.provider).sort()).toEqual(
      expectedProviders.sort(),
    )
  })

  test('every provider catalog validates', async () => {
    const providerCatalogs = await loadProviderCatalogs()

    const failures = providerCatalogs
      .map(catalog => ({
        provider: catalog.provider,
        result: validateProviderCatalog(catalog),
      }))
      .filter(({ result }) => !result.valid)

    expect(failures).toEqual([])
  })

  test('provider-specific endpoint URLs match current runtime shapes', async () => {
    const providerCatalogs = await loadProviderCatalogs()
    const byProvider = new Map(
      providerCatalogs.map(catalog => [catalog.provider, catalog]),
    )

    const ollama = byProvider.get('ollama')
    expect(joinUrl(ollama?.baseUrl, ollama?.endpoints.chatCompletions?.path ?? ''))
      .toBe('http://localhost:11434/v1/chat/completions')
    expect(joinUrl(ollama?.baseUrl, ollama?.endpoints.models?.path ?? '')).toBe(
      'http://localhost:11434/api/tags',
    )

    const githubCopilot = byProvider.get('github-copilot')
    expect(
      joinUrl(githubCopilot?.baseUrl, githubCopilot?.endpoints.messages?.path ?? ''),
    ).toBe('https://api.githubcopilot.com/v1/messages')

    const anthropic = byProvider.get('anthropic')
    expect(joinUrl(anthropic?.baseUrl, anthropic?.endpoints.models?.path ?? ''))
      .toBe('https://api.anthropic.com/v1/models')
  })
})
