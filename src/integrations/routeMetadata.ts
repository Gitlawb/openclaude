import type {
  GatewayDescriptor,
  TransportKind,
  ValidationRoutingMetadata,
  VendorDescriptor,
} from './descriptors.js'
import {
  ensureIntegrationsLoaded,
  getAllGateways,
  getAllVendors,
  getGateway,
  getVendor,
  resolveProfileRoute,
} from './index.js'
import { isEnvTruthy } from '../utils/envUtils.js'

export type RouteDescriptor = GatewayDescriptor | VendorDescriptor

const TRANSPORT_KIND_PROVIDER_TYPE_LABELS: Partial<
  Record<TransportKind, string>
> = {
  'anthropic-native': 'Anthropic native API',
  'gemini-native': 'Gemini API',
  bedrock: 'AWS Bedrock Claude API',
  vertex: 'Google Vertex Claude API',
  'anthropic-proxy': 'Anthropic-compatible API',
  local: 'OpenAI-compatible API',
  'openai-compatible': 'OpenAI-compatible API',
}

function getValidationRoutingHosts(
  descriptor: RouteDescriptor,
): string[] {
  const routing = descriptor.validation?.routing as
    | ValidationRoutingMetadata
    | undefined
  return routing?.matchBaseUrlHosts ?? []
}

function normalizeComparableBaseUrl(
  baseUrl?: string,
): string | null {
  if (!baseUrl?.trim()) {
    return null
  }

  try {
    const parsed = new URL(baseUrl)
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString().replace(/\/+$/, '').toLowerCase()
  } catch {
    return baseUrl.trim().replace(/\/+$/, '').toLowerCase() || null
  }
}

function normalizeHost(
  baseUrl?: string,
): string | null {
  if (!baseUrl?.trim()) {
    return null
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

function getAllRoutes(): RouteDescriptor[] {
  ensureIntegrationsLoaded()
  return [...getAllGateways(), ...getAllVendors()]
}

function resolveKnownLocalRouteIdFromBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) {
    return null
  }

  try {
    const parsed = new URL(baseUrl)
    const host = parsed.host.toLowerCase()
    const hostname = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const haystack = `${hostname} ${path}`

    if (host.endsWith(':11434') || haystack.includes('ollama')) {
      return 'ollama'
    }
    if (
      host.endsWith(':1234') ||
      haystack.includes('lmstudio') ||
      haystack.includes('lm-studio')
    ) {
      return 'lmstudio'
    }
  } catch {
    return null
  }

  return null
}

export function getRouteDescriptor(
  routeId: string,
): RouteDescriptor | null {
  ensureIntegrationsLoaded()
  return getGateway(routeId) ?? getVendor(routeId) ?? null
}

export function getRouteLabel(
  routeId: string,
): string | null {
  return getRouteDescriptor(routeId)?.label ?? null
}

export function getRouteDefaultBaseUrl(
  routeId: string,
): string | undefined {
  return getRouteDescriptor(routeId)?.defaultBaseUrl
}

export function getRouteDefaultModel(
  routeId: string,
): string | undefined {
  const descriptor = getRouteDescriptor(routeId)
  if (!descriptor) {
    return undefined
  }

  if ('defaultModel' in descriptor && descriptor.defaultModel) {
    return Array.isArray(descriptor.defaultModel)
      ? descriptor.defaultModel.join(', ')
      : descriptor.defaultModel
  }

  const catalogModels = descriptor.catalog?.models ?? []
  const defaultEntry =
    catalogModels.find(model => model.default) ?? catalogModels[0]

  return defaultEntry?.apiName
}

export function routeSupportsCustomHeaders(
  routeId: string,
): boolean {
  const descriptor = getRouteDescriptor(routeId)
  if (!descriptor) {
    return false
  }

  return Boolean(
    descriptor.transportConfig.supportsUserCustomHeaders ??
      descriptor.transportConfig.openaiShim?.supportsUserCustomHeaders,
  )
}

export function getRouteProviderTypeLabel(
  routeId: string,
): string {
  const kind = getRouteDescriptor(routeId)?.transportConfig.kind
  return (
    (kind ? TRANSPORT_KIND_PROVIDER_TYPE_LABELS[kind] : undefined) ??
    'OpenAI-compatible API'
  )
}

export function resolveRouteIdFromBaseUrl(
  baseUrl?: string,
  options?: {
    requireDiscovery?: boolean
  },
): string | null {
  const normalizedBaseUrl = normalizeComparableBaseUrl(baseUrl)
  const normalizedHost = normalizeHost(baseUrl)
  if (!normalizedBaseUrl && !normalizedHost) {
    return null
  }

  const routes = getAllRoutes().filter(route =>
    options?.requireDiscovery ? Boolean(route.catalog?.discovery) : true,
  )

  for (const route of routes) {
    const normalizedDefaultBaseUrl = normalizeComparableBaseUrl(
      route.defaultBaseUrl,
    )
    if (
      normalizedBaseUrl &&
      normalizedDefaultBaseUrl === normalizedBaseUrl
    ) {
      return route.id
    }
  }

  if (normalizedHost) {
    for (const route of routes) {
      if (getValidationRoutingHosts(route).includes(normalizedHost)) {
        return route.id
      }
    }
  }

  const localRouteId = resolveKnownLocalRouteIdFromBaseUrl(baseUrl)
  if (localRouteId) {
    return localRouteId
  }

  return null
}

export function resolveActiveRouteIdFromEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
  options?: {
    activeProfileProvider?: string
  },
): string | null {
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GEMINI)) {
    return 'gemini'
  }
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_MISTRAL)) {
    return 'mistral'
  }
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB)) {
    return 'github'
  }
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_BEDROCK)) {
    return 'bedrock'
  }
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_VERTEX)) {
    return 'vertex'
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_OPENAI)) {
    if (
      processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1' &&
      options?.activeProfileProvider
    ) {
      const route = resolveProfileRoute(options.activeProfileProvider)
      if (route.routeId !== 'unknown-fallback') {
        return route.routeId
      }
    }

    const baseUrl =
      processEnv.OPENAI_BASE_URL ?? processEnv.OPENAI_API_BASE
    const matchedRoute = resolveRouteIdFromBaseUrl(baseUrl)
    if (matchedRoute) {
      return matchedRoute
    }

    const normalizedBaseUrl = normalizeComparableBaseUrl(baseUrl)
    const openAIDefaultBaseUrl = normalizeComparableBaseUrl(
      getRouteDefaultBaseUrl('openai'),
    )

    if (!normalizedBaseUrl || normalizedBaseUrl === openAIDefaultBaseUrl) {
      return 'openai'
    }

    return 'custom'
  }

  return 'anthropic'
}

export function getTransportKindForRoute(
  routeId: string,
): TransportKind | null {
  return getRouteDescriptor(routeId)?.transportConfig.kind ?? null
}
