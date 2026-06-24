import type {
  ModelCatalogEntry,
  OpenAIShimTransportConfig,
} from './descriptors.js'
import {
  getOpenAIContextWindowMatches,
  getOpenAIMaxOutputTokenMatches,
} from '../utils/model/openaiContextWindows.js'
import { getCachedModelsSync } from './discoveryCache.js'
import {
  getDiscoveryCacheKey,
  getDiscoveryCacheTtlMs,
} from './discoveryService.js'
import { ensureIntegrationsLoaded } from './index.js'
import {
  getAllModels,
  getCatalogEntriesForRoute,
  getModel,
} from './registry.js'
import {
  getRouteDescriptor,
  resolveRouteCredentialValue,
  resolveActiveRouteIdFromEnv,
  resolveRouteIdFromBaseUrl,
  type RouteDescriptor,
} from './routeMetadata.js'
import { parseCustomHeadersEnv } from '../utils/providerCustomHeaders.js'
import { firstUsableCredential } from '../services/api/credentialPool.js'

function normalizeModelApiName(
  value: string | undefined,
): string | null {
  const baseModel = getBaseModelApiName(value)
  return baseModel ? baseModel.toLowerCase() : null
}

function getBaseModelApiName(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const queryIndex = trimmed.indexOf('?')
  const baseModel =
    queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex).trim()
  return baseModel || null
}

function matchesCatalogEntryModel(
  routeId: string,
  entry: ModelCatalogEntry,
  modelApiName: string,
): boolean {
  if (entry.apiName.trim().toLowerCase() === modelApiName) {
    return true
  }

  if (!entry.modelDescriptorId) {
    return false
  }

  const modelDescriptor = getModel(entry.modelDescriptorId)
  if (!modelDescriptor) {
    return false
  }

  if (modelDescriptor.defaultModel.trim().toLowerCase() === modelApiName) {
    return true
  }

  const providerMappedModel = modelDescriptor.providerModelMap?.[routeId]
  return providerMappedModel?.trim().toLowerCase() === modelApiName
}

function getCatalogEntryForModel(
  routeId: string,
  modelApiName: string | undefined,
): ModelCatalogEntry | null {
  const normalizedModel = normalizeModelApiName(modelApiName)
  if (!normalizedModel) {
    return null
  }

  ensureIntegrationsLoaded()
  const entries = getCatalogEntriesForRoute(routeId)
  return (
    entries.find(entry =>
      matchesCatalogEntryModel(routeId, entry, normalizedModel),
    ) ?? null
  )
}

function mergeRemoveBodyFields(
  ...sources: Array<string[] | undefined>
): string[] | undefined {
  const merged = new Set<string>()

  for (const source of sources) {
    for (const field of source ?? []) {
      const normalized = field.trim()
      if (normalized) {
        merged.add(normalized)
      }
    }
  }

  return merged.size > 0 ? [...merged] : undefined
}

function mergeOpenAIShimConfig(
  baseConfig: OpenAIShimTransportConfig | undefined,
  entryConfig: Partial<OpenAIShimTransportConfig> | undefined,
  inferredConfig: Partial<OpenAIShimTransportConfig> | undefined,
): OpenAIShimTransportConfig {
  return {
    ...baseConfig,
    ...entryConfig,
    ...inferredConfig,
    removeBodyFields: mergeRemoveBodyFields(
      baseConfig?.removeBodyFields,
      entryConfig?.removeBodyFields,
      inferredConfig?.removeBodyFields,
    ),
  }
}

function normalizePrefix(value: string): string {
  return value.trim().toLowerCase()
}

export function openAIShimSupportsApiFormatForModel(
  config:
    | Pick<OpenAIShimTransportConfig, 'responsesApiModelPrefixes'>
    | undefined,
  apiFormat: 'responses',
  modelApiName: string | undefined,
): boolean {
  const prefixes =
    apiFormat === 'responses'
      ? config?.responsesApiModelPrefixes
          ?.map(normalizePrefix)
          .filter(Boolean)
      : undefined

  if (!prefixes || prefixes.length === 0) {
    return true
  }

  const normalizedModel = normalizeModelApiName(modelApiName)
  if (!normalizedModel) {
    return false
  }

  return prefixes.some(prefix => normalizedModel.startsWith(prefix))
}

function inferRemoteModelOpenAIShimConfig(
  modelApiName: string | undefined,
): Partial<OpenAIShimTransportConfig> | undefined {
  const normalizedModel = normalizeModelApiName(modelApiName)
  if (!normalizedModel) {
    return undefined
  }

  if (normalizedModel.startsWith('mimo-v2')) {
    return {
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      maxTokensField: 'max_completion_tokens',
      removeBodyFields: ['store', 'stream_options'],
    }
  }

  // Segment-boundary-aware matcher: avoids false-positives like "my-deepseek-rag"
  // while still catching aggregator paths e.g. "openrouter/deepseek/deepseek-chat".
  const segments = normalizedModel.split('/')
  const hasDeepseek = segments.some(s => s.startsWith('deepseek'))
  if (hasDeepseek) {
    return {
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      reasoningContentFallback: '',
      thinkingRequestFormat: 'deepseek-compatible',
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store'],
    }
  }

   const hasKimiMoonshot = segments.some(
     s => s.startsWith('kimi') || s.startsWith('moonshot'),
   )
   if (hasKimiMoonshot) {
    return {
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      reasoningContentFallback: '',
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store'],
    }
  }

  return undefined
}

export type OpenAIShimRuntimeContext = {
  routeId: string | null
  descriptor: RouteDescriptor | null
  catalogEntry: ModelCatalogEntry | null
  openaiShimConfig: OpenAIShimTransportConfig
}

export type ModelRuntimeLimits = {
  contextWindow?: number
  maxOutputTokens?: number
}

export function resolveOpenAIShimRuntimeContext(options?: {
  processEnv?: NodeJS.ProcessEnv
  baseUrl?: string
  model?: string
  activeProfileProvider?: string
  treatAsLocal?: boolean
}): OpenAIShimRuntimeContext {
  const processEnv = options?.processEnv ?? process.env
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...processEnv,
  }

  if (options?.baseUrl !== undefined) {
    runtimeEnv.OPENAI_BASE_URL = options.baseUrl
  }

  if (options?.model !== undefined) {
    runtimeEnv.OPENAI_MODEL = options.model
  }

  const activeRouteId = resolveActiveRouteIdFromEnv(runtimeEnv, {
    activeProfileProvider: options?.activeProfileProvider,
  })
  const baseUrlRouteId = resolveRouteIdFromBaseUrl(options?.baseUrl)
  const routeId =
    baseUrlRouteId &&
    (!activeRouteId || activeRouteId === 'anthropic' || activeRouteId === 'openai')
      ? baseUrlRouteId
      : activeRouteId
  const descriptor =
    routeId && routeId !== 'anthropic'
      ? getRouteDescriptor(routeId)
      : null
  const catalogEntry =
    descriptor && routeId
      ? getCatalogEntryForModel(routeId, options?.model)
      : null
  const inferredConfig =
    options?.treatAsLocal === true
      ? {
          maxTokensField: 'max_tokens' as const,
        }
      : inferRemoteModelOpenAIShimConfig(options?.model)

  return {
    routeId,
    descriptor,
    catalogEntry,
    openaiShimConfig: mergeOpenAIShimConfig(
      descriptor?.transportConfig.openaiShim,
      catalogEntry?.transportOverrides?.openaiShim,
      inferredConfig,
    ),
  }
}

function getModelDescriptorForCatalogEntry(entry: ModelCatalogEntry | null) {
  if (!entry?.modelDescriptorId) {
    return null
  }

  return getModel(entry.modelDescriptorId) ?? null
}

function getProviderScopedModelSegments(modelApiName: string): string[] {
  const segments = modelApiName
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
  const suffixes = segments
    .slice(1)
    .map((_, index) => segments.slice(index + 1).join('/'))
  const accountQualifiedSuffixes = suffixes
    .filter(suffix => /^[^/]+\/models\//.test(suffix))
    .map(suffix => `accounts/${suffix}`)

  return [...suffixes, ...accountQualifiedSuffixes]
}

function findModelDescriptorForApiName(
  routeId: string | null,
  modelApiName: string | undefined,
) {
  const trimmedModel = getBaseModelApiName(modelApiName)
  if (!trimmedModel) {
    return null
  }
  const normalizedModel = trimmedModel.toLowerCase()
  const providerScopedSegments = getProviderScopedModelSegments(trimmedModel)
  const normalizedProviderScopedSegments = getProviderScopedModelSegments(
    normalizedModel,
  )

  ensureIntegrationsLoaded()
  const models = getAllModels()
    .map(model => {
      const providerModelMap = model.providerModelMap
      const routeMappedModel = routeId
        ? providerModelMap?.[routeId]
        : undefined
      const hasProviderModelMap =
        providerModelMap && Object.keys(providerModelMap).length > 0
      return {
        model,
        names: [
          model.id,
          hasProviderModelMap ? routeMappedModel : model.defaultModel,
          routeMappedModel,
        ].filter((value): value is string => Boolean(value?.trim())),
      }
    })
    .sort((left, right) => {
      const leftLongest = Math.max(...left.names.map(name => name.length))
      const rightLongest = Math.max(...right.names.map(name => name.length))
      return rightLongest - leftLongest
    })

  for (const candidate of models) {
    if (candidate.names.some(name => trimmedModel === name.trim())) {
      return candidate.model
    }
  }

  for (const candidate of models) {
    if (candidate.names.some(name => trimmedModel.startsWith(name.trim()))) {
      return candidate.model
    }
  }

  for (const candidate of models) {
    if (candidate.names.some(name => providerScopedSegments.includes(name.trim()))) {
      return candidate.model
    }
  }

  for (const candidate of models) {
    if (
      candidate.names.some(name => {
        const normalizedName = name.trim().toLowerCase()
        return (
          normalizedModel === normalizedName ||
          normalizedModel.startsWith(normalizedName) ||
          normalizedProviderScopedSegments.includes(normalizedName)
        )
      })
    ) {
      return candidate.model
    }
  }

  return null
}

function findCatalogEntryForApiName(
  routeId: string | null,
  modelApiName: string | undefined,
): ModelCatalogEntry | null {
  if (!routeId || routeId === 'anthropic') {
    return null
  }

  return getCatalogEntryForModel(routeId, modelApiName)
}

function findCachedCatalogEntryForApiName(
  routeId: string | null,
  modelApiName: string | undefined,
  runtimeEnv: NodeJS.ProcessEnv,
): ModelCatalogEntry | null {
  const normalizedModel = normalizeModelApiName(modelApiName)
  if (!routeId || routeId === 'anthropic' || !normalizedModel) {
    return null
  }

  const catalog = getRouteDescriptor(routeId)?.catalog
  if (!catalog?.discovery) {
    return null
  }

  const baseUrl = runtimeEnv.OPENAI_BASE_URL ?? runtimeEnv.OPENAI_API_BASE
  const cacheKey = getDiscoveryCacheKey(routeId, {
    baseUrl,
    apiKey: firstUsableCredential(
      resolveRouteCredentialValue({
        routeId,
        baseUrl,
        processEnv: runtimeEnv,
      }),
    ),
    headers: parseCustomHeadersEnv(runtimeEnv.ANTHROPIC_CUSTOM_HEADERS),
  })
  const cached = getCachedModelsSync(cacheKey, getDiscoveryCacheTtlMs(routeId))

  return (
    cached?.models.find(entry =>
      matchesCatalogEntryModel(routeId, entry, normalizedModel),
    ) ?? null
  )
}

export function resolveModelRuntimeLimits(options: {
  model: string
  processEnv?: NodeJS.ProcessEnv
  baseUrl?: string
  activeProfileProvider?: string
}): ModelRuntimeLimits {
  const processEnv = options.processEnv ?? process.env
  const runtimeEnv: NodeJS.ProcessEnv = { ...processEnv }
  if (options.baseUrl !== undefined) {
    runtimeEnv.OPENAI_BASE_URL = options.baseUrl
  }

  const routeId = resolveActiveRouteIdFromEnv(runtimeEnv, {
    activeProfileProvider: options.activeProfileProvider,
  })
  const modelApiName = getBaseModelApiName(options.model) ?? options.model
  const catalogEntry = findCatalogEntryForApiName(routeId, modelApiName)
  const cachedCatalogEntry = findCachedCatalogEntryForApiName(
    routeId,
    modelApiName,
    runtimeEnv,
  )
  const modelDescriptor =
    getModelDescriptorForCatalogEntry(catalogEntry) ??
    getModelDescriptorForCatalogEntry(cachedCatalogEntry) ??
    findModelDescriptorForApiName(routeId, modelApiName)
  const externalContextWindow = getOpenAIContextWindowMatches(
    modelApiName,
    runtimeEnv,
  )
  const externalMaxOutputTokens = getOpenAIMaxOutputTokenMatches(
    modelApiName,
    runtimeEnv,
  )

  return {
    contextWindow:
      externalContextWindow.exact ??
      catalogEntry?.contextWindow ??
      cachedCatalogEntry?.contextWindow ??
      externalContextWindow.prefix ??
      modelDescriptor?.contextWindow,
    maxOutputTokens:
      externalMaxOutputTokens.exact ??
      catalogEntry?.maxOutputTokens ??
      cachedCatalogEntry?.maxOutputTokens ??
      externalMaxOutputTokens.prefix ??
      modelDescriptor?.maxOutputTokens,
  }
}

export function usesAnthropicNativeMessageFormat(options?: {
  processEnv?: NodeJS.ProcessEnv
  model?: string
  activeProfileProvider?: string
  providerCategory?:
    | 'firstParty'
    | 'bedrock'
    | 'vertex'
    | 'foundry'
    | 'openai'
    | 'gemini'
    | 'github'
    | 'codex'
    | 'nvidia-nim'
    | 'minimax'
    | 'mistral'
}): boolean {
  const processEnv = options?.processEnv ?? process.env
  const providerCategory = options?.providerCategory

  if (
    providerCategory === 'firstParty' ||
    providerCategory === 'bedrock' ||
    providerCategory === 'vertex' ||
    providerCategory === 'foundry'
  ) {
    return true
  }

  if (providerCategory && providerCategory !== 'github') {
    return false
  }

  const routeId = resolveActiveRouteIdFromEnv(processEnv, {
    activeProfileProvider: options?.activeProfileProvider,
  })

  if (
    routeId === 'anthropic' ||
    routeId === 'bedrock' ||
    routeId === 'vertex'
  ) {
    return true
  }

  if (routeId !== 'github') {
    return false
  }

  const model = options?.model?.trim() || processEnv.OPENAI_MODEL?.trim() || ''
  return model.toLowerCase().includes('claude-')
}
