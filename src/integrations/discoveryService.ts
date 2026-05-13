import { createHash } from 'node:crypto'
import {
  getCachedModels,
  isCacheStale,
  parseDurationString,
  recordDiscoveryError,
  setCachedModels,
  type DiscoveryCacheError,
} from './discoveryCache.js'
import type {
  ModelCatalogConfig,
  ModelCatalogEntry,
  ReadinessProbeKind,
} from './descriptors.js'
import { resolveRouteIdFromBaseUrl } from './index.js'
import {
  getRouteDescriptor,
  resolveActiveRouteIdFromEnv,
  resolveRouteCredentialValue,
} from './routeMetadata.js'
import type {
  AtomicChatReadiness,
  OllamaGenerationReadiness,
} from '../utils/providerDiscovery.js'
import {
  listOpenAICompatibleModels,
  probeOllamaModelCatalog,
  probeAtomicChatReadiness,
  probeOllamaGenerationReadiness,
} from '../utils/providerDiscovery.js'
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js'

export type RouteDiscoveryResult = {
  routeId: string
  models: ModelCatalogEntry[]
  stale: boolean
  error: DiscoveryCacheError | null
  source: 'network' | 'cache' | 'stale-cache' | 'static' | 'error'
}

export type OpenAICompatibleReadiness =
  | { state: 'unreachable' }
  | { state: 'no_models' }
  | { state: 'ready'; models: string[] }

export type RouteReadinessResult =
  | OllamaGenerationReadiness
  | AtomicChatReadiness
  | OpenAICompatibleReadiness

function shouldSkipNonessentialDiscoveryTraffic(): boolean {
  return (
    isEssentialTrafficOnly() ||
    Boolean(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
  )
}

function getRouteCatalog(routeId: string): ModelCatalogConfig | null {
  return getRouteDescriptor(routeId)?.catalog ?? null
}

export function resolveDiscoveryRouteIdFromBaseUrl(
  baseUrl?: string,
): string | null {
  return resolveRouteIdFromBaseUrl(baseUrl, { requireDiscovery: true })
}

function getCatalogEntries(
  routeId: string,
): ModelCatalogEntry[] {
  return getRouteCatalog(routeId)?.models ?? []
}

function getDiscoveryCacheTtlMs(
  routeId: string,
): number {
  const ttl = getRouteCatalog(routeId)?.discoveryCacheTtl ?? 0
  return typeof ttl === 'string' || typeof ttl === 'number'
    ? parseDurationString(ttl)
    : 0
}

function normalizeDiscoveryCacheBaseUrl(
  baseUrl: string | undefined,
): string {
  if (!baseUrl?.trim()) {
    return ''
  }

  try {
    const parsed = new URL(baseUrl)
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString().replace(/\/+$/, '').toLowerCase()
  } catch {
    return baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  }
}

function normalizeDiscoveryCacheHeaders(
  headers: Record<string, string> | undefined,
): Array<[string, string]> {
  return Object.entries(headers ?? {})
    .map(([name, value]) => [name.trim().toLowerCase(), value.trim()] as const)
    .filter(([name, value]) => name && value)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
}

function hashDiscoveryCachePartition(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)
}

export function getDiscoveryCacheKey(
  routeId: string,
  options?: {
    baseUrl?: string
    apiKey?: string
    headers?: Record<string, string>
  },
): string {
  const discoveryApiKey = getRouteDiscoveryApiKey(routeId, options)
  const partition = {
    baseUrl: normalizeDiscoveryCacheBaseUrl(getRouteBaseUrl(routeId, options)),
    apiKeyHash: discoveryApiKey
      ? hashDiscoveryCachePartition(discoveryApiKey)
      : '',
    headers: normalizeDiscoveryCacheHeaders(
      getRouteDiscoveryHeaders(routeId, options),
    ),
  }

  return `${routeId}:${hashDiscoveryCachePartition(partition)}`
}

function getRouteBaseUrl(
  routeId: string,
  options?: { baseUrl?: string },
): string | undefined {
  return options?.baseUrl ?? getRouteDescriptor(routeId)?.defaultBaseUrl
}

function getRouteDiscoveryApiKey(
  routeId: string,
  options?: { apiKey?: string },
): string | undefined {
  if (getRouteCatalog(routeId)?.discovery?.requiresAuth === false) {
    return undefined
  }

  if (options?.apiKey?.trim()) {
    return options.apiKey.trim()
  }

  return resolveRouteCredentialValue({
    routeId,
    processEnv: process.env,
  })
}

function getRouteDiscoveryHeaders(
  routeId: string,
  options?: { headers?: Record<string, string> },
): Record<string, string> | undefined {
  const transportConfig = getRouteDescriptor(routeId)?.transportConfig
  const headers = {
    ...(transportConfig?.headers ?? {}),
    ...(transportConfig?.openaiShim?.headers ?? {}),
    ...(options?.headers ?? {}),
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

function toDiscoveredModelEntry(modelId: string): ModelCatalogEntry {
  return {
    id: modelId,
    apiName: modelId,
    label: modelId,
  }
}

function toOllamaModelEntry(model: { name: string }): ModelCatalogEntry {
  return {
    id: model.name,
    apiName: model.name,
    label: model.name,
  }
}

function mergeCatalogEntries(
  staticEntries: ModelCatalogEntry[],
  discoveredEntries: ModelCatalogEntry[],
): ModelCatalogEntry[] {
  const merged = [...staticEntries]
  const existingApiNames = new Set(
    staticEntries.map(entry => entry.apiName.toLowerCase()),
  )

  for (const entry of discoveredEntries) {
    if (existingApiNames.has(entry.apiName.toLowerCase())) {
      continue
    }
    existingApiNames.add(entry.apiName.toLowerCase())
    merged.push(entry)
  }

  return merged
}

async function runDiscovery(
  routeId: string,
  options?: {
    baseUrl?: string
    apiKey?: string
    headers?: Record<string, string>
  },
): Promise<ModelCatalogEntry[] | null> {
  const catalog = getRouteCatalog(routeId)
  const discovery = catalog?.discovery
  if (!catalog || !discovery) {
    return null
  }

  switch (discovery.kind) {
    case 'ollama': {
      const result = await probeOllamaModelCatalog({
        baseUrl: getRouteBaseUrl(routeId, options),
      })
      if (!result.reachable) {
        return null
      }
      return result.models.map(model => toOllamaModelEntry(model))
    }

    case 'openai-compatible': {
      const models = await listOpenAICompatibleModels({
        baseUrl: getRouteBaseUrl(routeId, options),
        apiKey: getRouteDiscoveryApiKey(routeId, options),
        headers: getRouteDiscoveryHeaders(routeId, options),
      })
      return models?.map(model => toDiscoveredModelEntry(model)) ?? null
    }

    case 'github-models': {
      const apiKey = getRouteDiscoveryApiKey(routeId, options)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Editor-Version': 'vscode/1.96.0',
        'Editor-Plugin-Version': 'copilot/1.250.0',
        'User-Agent': 'GitHubCopilot/1.250.0',
        Accept: 'application/json',
      }

      function formatModelLabel(rawId: string): string {
        const base = rawId.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{4}$/, '')
        if (base.startsWith('claude-')) {
          const parts = base.replace('claude-', '').split('-')
          if (parts.length >= 2) return `Claude ${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)} ${parts.slice(1).join('.')}`
        }
        if (base.startsWith('gpt-')) {
          const rest = base.slice(4)
          const named = rest
            .replace(/^4o-mini/, '4o Mini')
            .replace(/^4o/, '4o')
            .replace(/^4-o/, '4o')
            .replace(/^4\.1/, '4.1')
            .replace(/^4/, '4')
            .replace(/^3\.5-turbo/, '3.5 Turbo')
            .replace(/^5\.5-mini/, '5.5 Mini')
            .replace(/^5\.5/, '5.5')
            .replace(/^5\.4-mini/, '5.4 Mini')
            .replace(/^5\.4/, '5.4')
            .replace(/^5\.3-codex/, '5.3 Codex')
            .replace(/^5\.2-codex/, '5.2 Codex')
            .replace(/^5\.2/, '5.2')
            .replace(/^5\.1-codex/, '5.1 Codex')
            .replace(/^5-mini/, '5 Mini')
            .replace(/^5/, '5')
          return `GPT-${named}`
        }
        if (base.startsWith('gemini-')) return base.replace('gemini-', 'Gemini ')
        if (base.startsWith('grok-')) {
          const v = base.replace('grok-', '')
          if (v === 'code-fast-1') return 'Grok Code Fast 1'
          return `Grok ${v}`
        }
        return rawId
      }

      try {
        const response = await fetch('https://api.githubcopilot.com/models', {
          headers,
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) return null

        const body = (await response.json()) as { data?: Array<{ id?: string }> }
        if (!body.data || !Array.isArray(body.data)) return null

        const seen = new Set<string>()
        const models = body.data
          .map(item => {
            const id = item.id?.trim()
            if (!id) return null
            if (id.startsWith('accounts/') || id.startsWith('oswe-') || id.includes('text-embedding')) return null
            if (seen.has(id)) return null
            seen.add(id)
            return { id, apiName: id, label: formatModelLabel(id) } as ModelCatalogEntry
          })
          .filter((m): m is ModelCatalogEntry => m !== null)

        return models.length > 0 ? models : null
      } catch {
        return null
      }
    }

    case 'custom':
      return null
  }
}

export async function discoverModelsForRoute(
  routeId: string,
  options?: {
    baseUrl?: string
    apiKey?: string
    headers?: Record<string, string>
    forceRefresh?: boolean
  },
): Promise<RouteDiscoveryResult | null> {
  const catalog = getRouteCatalog(routeId)
  if (!catalog) {
    return null
  }

  const staticEntries = getCatalogEntries(routeId)
  if (!catalog.discovery) {
    return {
      routeId,
      models: staticEntries,
      stale: false,
      error: null,
      source: 'static',
    }
  }

  const ttlMs = getDiscoveryCacheTtlMs(routeId)
  const cacheKey = getDiscoveryCacheKey(routeId, options)
  if (!options?.forceRefresh && ttlMs > 0) {
    const cached = await getCachedModels(cacheKey, ttlMs)
    if (cached) {
      return {
        routeId,
        models: mergeCatalogEntries(staticEntries, cached.models),
        stale: false,
        error: cached.error,
        source: 'cache',
      }
    }
  }

  if (shouldSkipNonessentialDiscoveryTraffic()) {
    const staleEntry = await getCachedModels(cacheKey, ttlMs, {
      includeStale: true,
    })

    if (staleEntry) {
      const stale = await isCacheStale(cacheKey, ttlMs)
      return {
        routeId,
        models: mergeCatalogEntries(staticEntries, staleEntry.models),
        stale,
        error: staleEntry.error,
        source: stale ? 'stale-cache' : 'cache',
      }
    }

    return {
      routeId,
      models: staticEntries,
      stale: false,
      error: null,
      source: 'static',
    }
  }

  try {
    const discovered = await runDiscovery(routeId, options)
    if (discovered === null) {
      throw new Error(`Discovery failed for route ${routeId}`)
    }

    await setCachedModels(cacheKey, { models: discovered })
    return {
      routeId,
      models: mergeCatalogEntries(staticEntries, discovered),
      stale: false,
      error: null,
      source: 'network',
    }
  } catch (error) {
    await recordDiscoveryError(cacheKey, error)

    const staleEntry = await getCachedModels(cacheKey, ttlMs, {
      includeStale: true,
    })

    if (staleEntry) {
      return {
        routeId,
        models: mergeCatalogEntries(staticEntries, staleEntry.models),
        stale: true,
        error: staleEntry.error,
        source: 'stale-cache',
      }
    }

    return {
      routeId,
      models: staticEntries,
      stale: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        recordedAt: Date.now(),
      },
      source: 'error',
    }
  }
}

export async function refreshStartupDiscoveryForRoute(
  routeId: string,
  options?: {
    baseUrl?: string
    apiKey?: string
    headers?: Record<string, string>
  },
): Promise<RouteDiscoveryResult | null> {
  const catalog = getRouteCatalog(routeId)
  if (!catalog?.discovery || catalog.discoveryRefreshMode !== 'startup') {
    return null
  }

  const ttlMs = getDiscoveryCacheTtlMs(routeId)
  const cacheKey = getDiscoveryCacheKey(routeId, options)
  if (ttlMs > 0) {
    const cached = await getCachedModels(cacheKey, ttlMs)
    if (cached) {
      return {
        routeId,
        models: mergeCatalogEntries(getCatalogEntries(routeId), cached.models),
        stale: false,
        error: cached.error,
        source: 'cache',
      }
    }
  }

  return discoverModelsForRoute(routeId, {
    ...options,
    forceRefresh: true,
  })
}

export async function refreshStartupDiscoveryForActiveRoute(
  options?: {
    processEnv?: NodeJS.ProcessEnv
    activeProfileProvider?: string
    baseUrl?: string
    apiKey?: string
    headers?: Record<string, string>
  },
): Promise<RouteDiscoveryResult | null> {
  const processEnv = options?.processEnv ?? process.env
  const baseUrl =
    options?.baseUrl ??
    processEnv.OPENAI_BASE_URL ??
    processEnv.OPENAI_API_BASE
  const routeId =
    resolveActiveRouteIdFromEnv(processEnv, {
      activeProfileProvider: options?.activeProfileProvider,
    }) ??
    resolveRouteIdFromBaseUrl(baseUrl)

  if (!routeId || routeId === 'anthropic' || routeId === 'custom') {
    return null
  }

  return refreshStartupDiscoveryForRoute(routeId, {
    baseUrl,
    headers: options?.headers,
    apiKey:
      options?.apiKey ??
      resolveRouteCredentialValue({
        routeId,
        baseUrl,
        processEnv,
        activeProfileProvider: options?.activeProfileProvider,
      }),
  })
}

function getReadinessProbeKind(routeId: string): ReadinessProbeKind | null {
  return getRouteDescriptor(routeId)?.startup?.probeReadiness ?? null
}

export function probeRouteReadiness(
  routeId: 'ollama',
  options?: {
    baseUrl?: string
    model?: string
    timeoutMs?: number
    apiKey?: string
  },
): Promise<OllamaGenerationReadiness | null>
export function probeRouteReadiness(
  routeId: 'atomic-chat',
  options?: {
    baseUrl?: string
    model?: string
    timeoutMs?: number
    apiKey?: string
  },
): Promise<AtomicChatReadiness | null>
export function probeRouteReadiness(
  routeId: string,
  options?: {
    baseUrl?: string
    model?: string
    timeoutMs?: number
    apiKey?: string
  },
): Promise<RouteReadinessResult | null>
export async function probeRouteReadiness(
  routeId: string,
  options?: {
    baseUrl?: string
    model?: string
    timeoutMs?: number
    apiKey?: string
  },
): Promise<RouteReadinessResult | null> {
  const readinessKind = getReadinessProbeKind(routeId)
  if (!readinessKind) {
    return null
  }

  switch (readinessKind) {
    case 'ollama-generation':
      return probeOllamaGenerationReadiness({
        baseUrl: getRouteBaseUrl(routeId, options),
        model: options?.model,
        timeoutMs: options?.timeoutMs,
      })

    case 'openai-compatible-models': {
      if (routeId === 'atomic-chat') {
        return probeAtomicChatReadiness({
          baseUrl: getRouteBaseUrl(routeId, options),
        })
      }

      const discovered = await runDiscovery(routeId, options)
      if (discovered === null) {
        return { state: 'unreachable' }
      }

      if (discovered.length === 0) {
        return { state: 'no_models' }
      }

      return {
        state: 'ready',
        models: discovered.map(entry => entry.apiName),
      }
    }
  }
}
