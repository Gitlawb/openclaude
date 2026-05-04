import type {
  ModelCatalogEntry,
  OpenAIShimTransportConfig,
} from './descriptors.js'
import {
  getOpenAIContextWindow,
  getOpenAIMaxOutputTokens,
} from '../utils/model/openaiContextWindows.js'
import { ensureIntegrationsLoaded } from './index.js'
import {
  getAllModels,
  getCatalogEntriesForRoute,
  getModel,
} from './registry.js'
import {
  getRouteDescriptor,
  resolveActiveRouteIdFromEnv,
  resolveRouteIdFromBaseUrl,
  type RouteDescriptor,
} from './routeMetadata.js'

function normalizeModelApiName(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed ? trimmed : null
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

  if (normalizedModel.includes('deepseek')) {
    return {
      preserveReasoningContent: true,
      requireReasoningContentOnAssistantMessages: true,
      reasoningContentFallback: '',
      thinkingRequestFormat: 'deepseek-compatible',
      maxTokensField: 'max_tokens',
      removeBodyFields: ['store'],
    }
  }

  if (normalizedModel.includes('kimi') || normalizedModel.includes('moonshot')) {
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

function findModelDescriptorForApiName(
  routeId: string | null,
  modelApiName: string | undefined,
) {
  const trimmedModel = modelApiName?.trim()
  if (!trimmedModel) {
    return null
  }
  const normalizedModel = trimmedModel.toLowerCase()

  ensureIntegrationsLoaded()
  const models = getAllModels()
    .map(model => {
      const routeMappedModel = routeId
        ? model.providerModelMap?.[routeId]
        : undefined
      return {
        model,
        names: [
          model.id,
          model.defaultModel,
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
    if (
      candidate.names.some(name => {
        const normalizedName = name.trim().toLowerCase()
        return (
          normalizedModel === normalizedName ||
          normalizedModel.startsWith(normalizedName)
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
  const catalogEntry = findCatalogEntryForApiName(routeId, options.model)
  const modelDescriptor =
    getModelDescriptorForCatalogEntry(catalogEntry) ??
    findModelDescriptorForApiName(routeId, options.model)
  const externalContextWindow = getOpenAIContextWindow(options.model, runtimeEnv)
  const externalMaxOutputTokens = getOpenAIMaxOutputTokens(
    options.model,
    runtimeEnv,
  )

  return {
    contextWindow:
      externalContextWindow ??
      catalogEntry?.contextWindow ??
      modelDescriptor?.contextWindow,
    maxOutputTokens:
      externalMaxOutputTokens ??
      catalogEntry?.maxOutputTokens ??
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
