import { PROVIDER_CATALOGS } from './providerCatalogs.js'
import { validateProviderCatalog } from './schema.js'
import type {
  CatalogEndpoint,
  CatalogRequestConfig,
  ModelCapabilities,
  ModelCatalogEntry,
  ModelCatalogTemplate,
  ModelEffort,
  ModelLimits,
  ModelPricing,
  NormalizedModelMetadata,
  ProviderCatalog,
  ProviderCatalogDefaults,
  ResolvedModelEndpoint,
} from './types.js'

type MergeableModelMetadata = Partial<ModelCatalogEntry>
type ModelMatch = {
  catalog: ProviderCatalog
  modelId: string
  entry: ModelCatalogEntry
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = cloneValue(nestedValue)
    }
    return result as T
  }

  return value
}

function deepFreeze<T>(value: T): T {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return value
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue)
  }

  return Object.freeze(value)
}

function deepMerge<T extends Record<string, unknown>>(...sources: T[]): T {
  const result: Record<string, unknown> = {}

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const existing = result[key]
      if (isPlainObject(existing) && isPlainObject(value)) {
        result[key] = deepMerge(existing, value)
      } else {
        result[key] = cloneValue(value)
      }
    }
  }

  return result as T
}

function defaultsToModelMetadata(
  defaults: ProviderCatalogDefaults | undefined,
): MergeableModelMetadata {
  if (!defaults) {
    return {}
  }

  return {
    endpoint: defaults.endpoint,
    limits: defaults.limits,
    capabilities: defaults.capabilities,
    effort: defaults.effort,
    pricing: defaults.pricing,
    visibility: defaults.visibility,
    ui: defaults.ui,
    request: defaults.request,
  }
}

function validateCatalog(catalog: ProviderCatalog): ProviderCatalog {
  const result = validateProviderCatalog(catalog)
  if (!result.valid) {
    throw new Error(
      `Invalid model catalog "${catalog.provider}": ${result.errors.join('; ')}`,
    )
  }

  const cycleErrors = findTemplateCycleErrors(catalog)
  if (cycleErrors.length > 0) {
    throw new Error(
      `Invalid model catalog "${catalog.provider}": ${cycleErrors.join('; ')}`,
    )
  }
  return deepFreeze(catalog)
}

const CATALOGS = PROVIDER_CATALOGS.map(validateCatalog)
const CATALOGS_BY_PROVIDER = new Map(
  CATALOGS.map((catalog) => [normalizeComparable(catalog.provider), catalog]),
)

export function getProviderCatalog(
  providerId: string,
): ProviderCatalog | undefined {
  return CATALOGS_BY_PROVIDER.get(normalizeComparable(providerId))
}

export function getAllProviderCatalogs(): ProviderCatalog[] {
  return [...CATALOGS]
}

function matchesModelReference(
  input: string,
  modelId: string,
  model: ModelCatalogEntry,
): boolean {
  const normalizedInput = normalizeComparable(input)
  const comparableValues = [
    modelId,
    model.apiName,
    model.canonicalModelId,
    ...(model.aliases ?? []),
    ...(model.compatibility?.legacyIds ?? []),
    ...(model.compatibility?.migrationAliases ?? []),
  ]

  return comparableValues.some(
    (value) =>
      typeof value === 'string' && normalizeComparable(value) === normalizedInput,
  )
}

function findTemplateCycleErrors(catalog: ProviderCatalog): string[] {
  const errors: string[] = []
  const templates = catalog.templates ?? {}

  function visit(templateId: string, stack: string[]): void {
    const cycleStart = stack.indexOf(templateId)
    if (cycleStart !== -1) {
      errors.push(
        `template inheritance cycle detected: ${[
          ...stack.slice(cycleStart),
          templateId,
        ].join(' -> ')}`,
      )
      return
    }

    const template = templates[templateId]
    if (!template) {
      return
    }

    const extendedTemplateIds = Array.isArray(template.extends)
      ? template.extends
      : []
    for (const extendedTemplateId of extendedTemplateIds) {
      visit(extendedTemplateId, [...stack, templateId])
    }
  }

  for (const templateId of Object.keys(templates)) {
    visit(templateId, [])
  }

  return [...new Set(errors)]
}

function findModelMatches(model: string, providerId?: string): ModelMatch[] {
  const catalogs = providerId
    ? [getProviderCatalog(providerId)].filter(
        (catalog): catalog is ProviderCatalog => catalog !== undefined,
      )
    : CATALOGS
  const matches: ModelMatch[] = []

  for (const catalog of catalogs) {
    for (const [modelId, entry] of Object.entries(catalog.models)) {
      if (matchesModelReference(model, modelId, entry)) {
        matches.push({ catalog, modelId, entry })
      }
    }
  }

  return matches
}

function findModel(model: string, providerId?: string): ModelMatch | undefined {
  const matches = findModelMatches(model, providerId)
  if (matches.length <= 1) {
    return matches[0]
  }

  throw new Error(
    `Ambiguous model lookup "${model.trim()}": matched ${matches
      .map((match) => `${match.catalog.provider}/${match.modelId}`)
      .join(', ')}`,
  )
}

function resolveTemplateMetadata(
  catalog: ProviderCatalog,
  templateId: string,
  stack: string[] = [],
): MergeableModelMetadata {
  const cycleStart = stack.indexOf(templateId)
  if (cycleStart !== -1) {
    throw new Error(
      `template inheritance cycle detected: ${[
        ...stack.slice(cycleStart),
        templateId,
      ].join(' -> ')}`,
    )
  }

  const template = catalog.templates?.[templateId]
  if (!template) {
    return {}
  }

  const templateExtends = Array.isArray(template.extends) ? template.extends : []
  const inheritedTemplates = templateExtends.map((extendedTemplateId) =>
    resolveTemplateMetadata(catalog, extendedTemplateId, [...stack, templateId]),
  )

  return deepMerge(
    ...inheritedTemplates,
    template as MergeableModelMetadata & ModelCatalogTemplate,
  )
}

function mergeModelMetadata(
  catalog: ProviderCatalog,
  modelId: string,
  entry: ModelCatalogEntry,
): NormalizedModelMetadata {
  const templateMetadata = (entry.extends ?? []).map((templateId) =>
    resolveTemplateMetadata(catalog, templateId),
  )
  const merged = deepMerge(
    defaultsToModelMetadata(catalog.defaults),
    ...templateMetadata,
    entry,
  )

  return {
    ...merged,
    provider: catalog.provider,
    id: modelId,
    label: merged.label ?? entry.label,
    apiName: merged.apiName ?? modelId,
    endpoint: merged.endpoint ?? catalog.defaults?.endpoint ?? '',
  } as NormalizedModelMetadata
}

export function resolveModelAlias(input: string, providerId?: string): string {
  return findModel(input, providerId)?.modelId ?? input.trim()
}

export function getModelMetadata(
  model: string,
  providerId?: string,
): NormalizedModelMetadata | undefined {
  const match = findModel(model, providerId)
  if (!match) {
    return undefined
  }

  return mergeModelMetadata(match.catalog, match.modelId, match.entry)
}

export function getModelLimits(
  model: string,
  providerId?: string,
): ModelLimits | undefined {
  return getModelMetadata(model, providerId)?.limits
}

export function getModelCapabilities(
  model: string,
  providerId?: string,
): ModelCapabilities | undefined {
  return getModelMetadata(model, providerId)?.capabilities
}

export function getModelEffort(
  model: string,
  providerId?: string,
): ModelEffort | undefined {
  return getModelMetadata(model, providerId)?.effort
}

export function getModelPricing(
  model: string,
  providerId?: string,
): ModelPricing | undefined {
  return getModelMetadata(model, providerId)?.pricing
}

function joinUrl(baseUrl: string | undefined, path: string): string | undefined {
  if (!baseUrl) {
    return undefined
  }

  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function getModelEndpoint(
  model: string,
  providerId?: string,
): ResolvedModelEndpoint | undefined {
  const match = findModel(model, providerId)
  if (!match) {
    return undefined
  }

  const metadata = mergeModelMetadata(match.catalog, match.modelId, match.entry)
  const endpoint = match.catalog.endpoints[metadata.endpoint]
  if (!endpoint) {
    return undefined
  }

  const request = deepMerge(
    (endpoint.request ?? {}) as CatalogRequestConfig,
    (match.catalog.defaults?.request ?? {}) as CatalogRequestConfig,
    (metadata.request ?? {}) as CatalogRequestConfig,
  )
  const resolvedEndpoint: CatalogEndpoint = {
    ...endpoint,
    request: Object.keys(request).length > 0 ? request : endpoint.request,
  }

  return {
    ...resolvedEndpoint,
    provider: match.catalog.provider,
    endpointId: metadata.endpoint,
    baseUrl: match.catalog.baseUrl,
    url: joinUrl(match.catalog.baseUrl, endpoint.path),
  }
}
