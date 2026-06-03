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
  fetchOpenAICompatibleModelsRaw,
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
      if (discovery.mapModel) {
        const rawModels = await fetchOpenAICompatibleModelsRaw({
          baseUrl: getRouteBaseUrl(routeId, options),
          apiKey: getRouteDiscoveryApiKey(routeId, options),
          headers: getRouteDiscoveryHeaders(routeId, options),
        })
        if (rawModels === null) {
          return null
        }
        const entries: ModelCatalogEntry[] = []
        for (const raw of rawModels) {
          const entry = discovery.mapModel(raw)
          if (entry !== null) {
            entries.push(entry)
          }
        }
        return entries
      }

      const models = await listOpenAICompatibleModels({
        baseUrl: getRouteBaseUrl(routeId, options),
        apiKey: getRouteDiscoveryApiKey(routeId, options),
        headers: getRouteDiscoveryHeaders(routeId, options),
      })
      return models?.map(model => toDiscoveredModelEntry(model)) ?? null
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
