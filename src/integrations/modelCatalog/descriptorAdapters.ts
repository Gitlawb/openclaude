import type {
  CapabilityFlags,
  ModelCatalogConfig as RouteModelCatalogConfig,
  ModelCatalogEntry as RouteModelCatalogEntry,
  ModelDescriptor,
  ModelDiscoveryConfig,
} from '../descriptors.js'
import {
  getAllProviderCatalogs,
  getModelMetadata,
  getProviderCatalog,
} from './catalog.js'
import type {
  ModelCapabilities,
  NormalizedModelMetadata,
  ProviderCatalog,
  ProviderDiscoveryConfig,
} from './types.js'

function toDescriptorCapabilities(
  capabilities: ModelCapabilities | undefined,
): CapabilityFlags {
  return {
    supportsVision: capabilities?.vision,
    supportsStreaming: capabilities?.streaming,
    supportsFunctionCalling: capabilities?.functionCalling,
    supportsJsonMode: capabilities?.jsonMode,
    supportsReasoning: capabilities?.reasoning,
    supportsPreciseTokenCount: capabilities?.preciseTokenCount,
  }
}

function toRouteDiscovery(
  catalog: ProviderCatalog,
  discovery: ProviderDiscoveryConfig | undefined,
): ModelDiscoveryConfig | undefined {
  if (!discovery) {
    return undefined
  }

  const endpoint = catalog.endpoints[discovery.endpoint]
  const kind =
    discovery.parser === 'ollama-tags'
      ? 'ollama'
      : discovery.parser === 'openai-models-list'
        ? 'openai-compatible'
        : 'custom'

  return {
    kind,
    requiresAuth: discovery.requiresAuth,
    path: endpoint?.path,
    parse: discovery.parser,
  }
}

function getDescriptorId(metadata: NormalizedModelMetadata): string | undefined {
  if (!metadata.brandId || !metadata.vendorId) {
    return undefined
  }

  return metadata.canonicalModelId ?? metadata.id
}

function getRouteDescriptorId(
  metadata: NormalizedModelMetadata,
): string | undefined {
  return metadata.canonicalModelId ?? getDescriptorId(metadata)
}

function toRouteCatalogEntry(
  metadata: NormalizedModelMetadata,
): RouteModelCatalogEntry {
  const descriptorId = getRouteDescriptorId(metadata)

  return {
    id: metadata.id,
    apiName: metadata.apiName,
    label: metadata.label,
    default: metadata.visibility?.defaultFor?.includes('main'),
    hidden: metadata.visibility?.hidden || metadata.status === 'hidden',
    modelDescriptorId: descriptorId,
    capabilities: toDescriptorCapabilities(metadata.capabilities),
    contextWindow: metadata.limits?.contextWindow,
    maxOutputTokens: metadata.limits?.maxOutputTokens?.upperLimit,
    transportOverrides: metadata.request
      ? {
          openaiShim: {
            maxTokensField: metadata.request.maxTokensField,
            preserveReasoningContent: metadata.request.preserveReasoningContent,
            requireReasoningContentOnAssistantMessages:
              metadata.request.requireReasoningContentOnAssistantMessages,
            reasoningContentFallback: metadata.request.reasoningContentFallback,
            thinkingRequestFormat: metadata.request.thinkingRequestFormat,
            removeBodyFields: metadata.request.removeBodyFields,
          },
        }
      : undefined,
  }
}

function getCatalogMetadata(catalog: ProviderCatalog): NormalizedModelMetadata[] {
  return Object.keys(catalog.models)
    .map(modelId => getModelMetadata(modelId, catalog.provider))
    .filter((metadata): metadata is NormalizedModelMetadata => Boolean(metadata))
}

export function getRouteCatalogEntries(
  routeId: string,
): RouteModelCatalogEntry[] {
  const catalog = getProviderCatalog(routeId)
  if (!catalog) {
    return []
  }

  return getCatalogMetadata(catalog).map(toRouteCatalogEntry)
}

export function getRouteCatalogConfig(
  routeId: string,
): RouteModelCatalogConfig | undefined {
  const catalog = getProviderCatalog(routeId)
  if (!catalog) {
    return undefined
  }

  const models = getRouteCatalogEntries(routeId)
  const hasVisibleStaticModels = models.some(model => !model.hidden)
  const discovery = toRouteDiscovery(catalog, catalog.discovery)

  return {
    source: discovery ? (hasVisibleStaticModels ? 'hybrid' : 'dynamic') : 'static',
    discovery,
    discoveryCacheTtl: catalog.discovery?.cacheTtl,
    discoveryRefreshMode: catalog.discovery?.refreshMode,
    allowManualRefresh: Boolean(discovery),
    models,
  }
}

export function getModelDescriptorsFromProviderCatalogs(): ModelDescriptor[] {
  const descriptors = new Map<string, ModelDescriptor>()

  for (const catalog of getAllProviderCatalogs()) {
    for (const metadata of getCatalogMetadata(catalog)) {
      const descriptorId = getDescriptorId(metadata)
      if (
        !descriptorId ||
        !metadata.vendorId ||
        descriptors.has(descriptorId)
      ) {
        continue
      }

      descriptors.set(descriptorId, {
        id: descriptorId,
        label: metadata.label,
        brandId: metadata.brandId,
        vendorId: metadata.vendorId,
        gatewayId: metadata.gatewayId,
        classification: metadata.classification ?? ['chat'],
        defaultModel: metadata.apiName,
        providerModelMap: metadata.compatibility?.providerModelMap,
        capabilities: toDescriptorCapabilities(metadata.capabilities),
        contextWindow: metadata.limits?.contextWindow,
        maxOutputTokens: metadata.limits?.maxOutputTokens?.upperLimit,
      })
    }
  }

  return [...descriptors.values()]
}
