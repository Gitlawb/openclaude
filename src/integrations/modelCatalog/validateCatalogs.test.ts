import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, mock, test } from 'bun:test'
import { visit } from 'jsonc-parser'
import { getModelMetadata } from './catalog.js'
import { validateProviderCatalog } from './schema.js'
import type { ProviderCatalog } from './types.js'

describe('provider catalog inventory', () => {
  const providerDir = path.join(import.meta.dir, 'providers')

  function joinUrl(baseUrl: string | undefined, path: string): string | undefined {
    if (!baseUrl) {
      return undefined
    }

    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  }

  async function loadProviderCatalogs(): Promise<ProviderCatalog[]> {
    mock.restore()
    const module = await import(
      `./providerCatalogs.generated.js?validateCatalogs=${Date.now()}-${Math.random()}`
    )
    return module.PROVIDER_CATALOGS
  }

  function providerJsonFiles(): string[] {
    return readdirSync(providerDir)
      .filter(fileName => fileName.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right))
  }

  function loadProviderJsonCatalog(fileName: string): ProviderCatalog {
    return JSON.parse(
      readFileSync(path.join(providerDir, fileName), 'utf8'),
    ) as ProviderCatalog
  }

  function findDuplicateJsonKeys(filePath: string): string[] {
    const source = readFileSync(filePath, 'utf8')
    const duplicates: string[] = []
    const objectStack: Array<Map<string, number>> = []

    function lineNumber(offset: number): number {
      return source.slice(0, offset).split('\n').length
    }

    visit(source, {
      onObjectBegin: () => {
        objectStack.push(new Map())
      },
      onObjectProperty: (property, offset) => {
        const keys = objectStack.at(-1)
        if (!keys) {
          return
        }
        const previousOffset = keys.get(property)
        if (previousOffset !== undefined) {
          duplicates.push(
            `${path.basename(filePath)}:${lineNumber(offset)} duplicate key "${property}" also appeared on line ${lineNumber(previousOffset)}`,
          )
          return
        }
        keys.set(property, offset)
      },
      onObjectEnd: () => {
        objectStack.pop()
      },
    })

    return duplicates
  }

  test('loads every provider JSON catalog', async () => {
    const providerCatalogs = await loadProviderCatalogs()
    const expectedProviderIdsFromJson = providerJsonFiles()
      .map(fileName => loadProviderJsonCatalog(fileName).provider)
      .sort()

    expect(providerCatalogs.map(catalog => catalog.provider).sort()).toEqual(
      expectedProviderIdsFromJson,
    )
  })

  test('provider JSON file names match provider ids', () => {
    const mismatches = providerJsonFiles().flatMap(fileName => {
      const providerId = loadProviderJsonCatalog(fileName).provider
      const fileProviderId = fileName.replace(/\.json$/, '')
      return providerId === fileProviderId
        ? []
        : [`${fileName}: provider "${providerId}" should match file name "${fileProviderId}"`]
    })

    expect(mismatches).toEqual([])
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

  test('provider JSON files do not contain duplicate object keys', () => {
    const duplicateKeys = providerJsonFiles()
      .flatMap(fileName => findDuplicateJsonKeys(path.join(providerDir, fileName)))

    expect(duplicateKeys).toEqual([])
  })

  test('provider default roles are explicit and unique', async () => {
    const providerCatalogs = await loadProviderCatalogs()
    const duplicateOrMissingDefaults = providerCatalogs.flatMap(catalog => {
      const roleOwners = new Map<string, string[]>()
      for (const [modelId, model] of Object.entries(catalog.models)) {
        for (const role of model.visibility?.defaultFor ?? []) {
          roleOwners.set(role, [...(roleOwners.get(role) ?? []), modelId])
        }
      }

      const failures: string[] = []
      const mainOwners = roleOwners.get('main') ?? []
      if (mainOwners.length !== 1) {
        failures.push(
          `${catalog.provider}: expected exactly one main default, found ${mainOwners.length || 0}`,
        )
      }
      for (const [role, modelIds] of roleOwners) {
        if (modelIds.length > 1) {
          failures.push(
            `${catalog.provider}: default role "${role}" is duplicated by ${modelIds.join(', ')}`,
          )
        }
      }
      return failures
    })

    expect(duplicateOrMissingDefaults).toEqual([])
  })

  test('Anthropic provider-specific compatibility mappings resolve to provider catalog entries', async () => {
    const providerCatalogs = await loadProviderCatalogs()
    const byProvider = new Map(
      providerCatalogs.map(catalog => [catalog.provider, catalog]),
    )
    const failures: string[] = []

    function modelReferences(modelId: string, model: ProviderCatalog['models'][string]): string[] {
      return [
        modelId,
        model.apiName,
        model.canonicalModelId,
        ...(model.aliases ?? []),
        ...(model.compatibility?.legacyIds ?? []),
        ...(model.compatibility?.migrationAliases ?? []),
      ].filter((value): value is string => Boolean(value?.trim()))
    }

    const anthropic = byProvider.get('anthropic')
    for (const [modelId, model] of Object.entries(anthropic?.models ?? {})) {
      for (const [providerId, providerModel] of Object.entries(
        model.compatibility?.providerModelMap ?? {},
      )) {
        const providerCatalog = byProvider.get(
          providerId === 'github' ? 'github-copilot' : providerId,
        )
        if (!providerCatalog) {
          failures.push(`${modelId}: provider mapping references missing provider "${providerId}"`)
          continue
        }
        const normalizedProviderModel = providerModel.trim().toLowerCase()
        const matches = Object.entries(providerCatalog.models).some(
          ([providerModelId, providerCatalogModel]) =>
            modelReferences(providerModelId, providerCatalogModel).some(
              reference => reference.trim().toLowerCase() === normalizedProviderModel,
            ),
        )
        if (!matches) {
          failures.push(
            `${modelId}: provider mapping ${providerId}="${providerModel}" does not resolve in ${providerCatalog.provider}.json`,
          )
        }
      }
    }

    expect(failures).toEqual([])
  })

  test('Anthropic gateway catalogs carry every Claude model variant', async () => {
    const providerCatalogs = await loadProviderCatalogs()
    const byProvider = new Map(
      providerCatalogs.map(catalog => [catalog.provider, catalog]),
    )
    const failures = ['bedrock', 'vertex', 'foundry'].flatMap(providerId => {
      const anthropicModelIds = Object.entries(byProvider.get('anthropic')?.models ?? {})
        .filter(([, model]) => model.compatibility?.providerModelMap?.[providerId])
        .map(([modelId]) => modelId)
        .sort()
      const providerCanonicalIds = Object.values(
        byProvider.get(providerId)?.models ?? {},
      )
        .map(model => model.canonicalModelId)
        .filter((value): value is string => Boolean(value))
        .sort()
      return JSON.stringify(providerCanonicalIds) === JSON.stringify(anthropicModelIds)
        ? []
        : [`${providerId}: expected ${anthropicModelIds.join(', ')}; got ${providerCanonicalIds.join(', ')}`]
    })

    expect(failures).toEqual([])
  })

  test('OpenCode Go catalog carries the documented model set and mixed endpoints', async () => {
    const providerCatalogs = await loadProviderCatalogs()
    const opencodeGo = providerCatalogs.find(catalog => catalog.provider === 'opencode-go')
    const expectedChatModels = [
      'glm-5.1',
      'glm-5',
      'kimi-k2.5',
      'kimi-k2.6',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'qwen3.6-plus',
      'qwen3.5-plus',
    ]
    const expectedMessageModels = [
      'minimax-m2.7',
      'minimax-m2.5',
    ]
    const expectedModels = [...expectedChatModels, ...expectedMessageModels].sort()

    expect(Object.keys(opencodeGo?.models ?? {}).sort()).toEqual(expectedModels)
    expect(
      expectedChatModels.map(modelId =>
        getModelMetadata(modelId, 'opencode-go')?.endpoint,
      ),
    ).toEqual(expectedChatModels.map(() => 'chatCompletions'))
    expect(
      expectedMessageModels.map(modelId =>
        getModelMetadata(modelId, 'opencode-go')?.endpoint,
      ),
    ).toEqual(expectedMessageModels.map(() => 'messages'))
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
