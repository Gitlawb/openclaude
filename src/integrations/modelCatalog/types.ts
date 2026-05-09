import type {
  AnthropicProxyDescriptor,
  CapabilityFlags,
  CatalogTransportOverrides,
  GatewayDescriptor,
  ModelCatalogEntry,
  ModelDescriptor,
  VendorDescriptor,
} from '../descriptors.js'

export type {
  AnthropicProxyDescriptor,
  CapabilityFlags,
  CatalogTransportOverrides,
  DiscoveryRefreshMode,
  DurationString,
  GatewayDescriptor,
  ModelCatalogConfig,
  ModelCatalogEntry,
  ModelDiscoveryConfig,
  ModelDiscoveryKind,
  ModelDescriptor,
  OpenAIShimTransportConfig,
  VendorDescriptor,
} from '../descriptors.js'

export type RouteDescriptor =
  | VendorDescriptor
  | GatewayDescriptor
  | AnthropicProxyDescriptor

export type NormalizedRouteCatalogEntry = ModelCatalogEntry & {
  routeId: string
  routeLabel: string
  modelDescriptor?: ModelDescriptor
}

export interface RouteCatalogValidationOptions {
  routeId?: string
  knownModelIds?: Iterable<string>
  validateSemantics?: boolean
}

export interface RouteCatalogValidationResult {
  valid: boolean
  errors: string[]
}

export interface RouteModelRuntimeMetadata {
  routeId: string
  routeLabel: string
  id: string
  apiName: string
  label: string
  default?: boolean
  hidden?: boolean
  modelDescriptorId?: string
  modelDescriptor?: ModelDescriptor
  capabilities: CapabilityFlags
  contextWindow?: number
  maxOutputTokens?: number
  transportOverrides?: CatalogTransportOverrides
  notes?: string
}
