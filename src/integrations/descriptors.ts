// src/integrations/descriptors.ts
// Core descriptor types for the integration registry.
// This file contains only type definitions — no runtime logic.

export type AuthMode = 'api-key' | 'oauth' | 'adc' | 'token' | 'none'

export type TransportKind =
  | 'anthropic-native'
  | 'anthropic-proxy'
  | 'openai-compatible'
  | 'local'
  | 'gemini-native'
  | 'bedrock'
  | 'vertex'

export type OpenAIShimTokenField = 'max_tokens' | 'max_completion_tokens'
export type OpenAIShimAuthScheme = 'bearer' | 'raw'

export interface OpenAIShimAuthHeaderConfig {
  name: string
  scheme?: OpenAIShimAuthScheme
}

export interface OpenAIShimUiConfig {
  showAuthHeader?: boolean
  showAuthHeaderValue?: boolean
  showCustomHeaders?: boolean
}

export interface OpenAIShimTransportConfig {
  headers?: Record<string, string>
  supportsApiFormatSelection?: boolean
  supportsAuthHeaders?: boolean
  ui?: OpenAIShimUiConfig
  defaultAuthHeader?: OpenAIShimAuthHeaderConfig
  responsesApiModelPrefixes?: string[]
  preserveReasoningContent?: boolean
  requireReasoningContentOnAssistantMessages?: boolean
  reasoningContentFallback?: '' | 'omit'
  thinkingRequestFormat?: 'none' | 'deepseek-compatible'
  maxTokensField?: OpenAIShimTokenField
  removeBodyFields?: string[]
}

export interface CapabilityFlags {
  supportsVision?: boolean
  supportsStreaming?: boolean
  supportsFunctionCalling?: boolean
  supportsJsonMode?: boolean
  supportsReasoning?: boolean
  supportsPreciseTokenCount?: boolean
  supportsEmbeddings?: boolean
}

export interface TransportConfig {
  kind: TransportKind
  headers?: Record<string, string>
  openaiShim?: OpenAIShimTransportConfig
}

export interface CatalogTransportOverrides {
  openaiShim?: Partial<OpenAIShimTransportConfig>
}

export interface CacheConfig {
  supported?: boolean
  maxCachedTokens?: number
  cachePrefix?: string
}

export type ModelCatalogSource = 'static' | 'dynamic' | 'hybrid'
export type DurationString = `${number}m` | `${number}h` | `${number}d`
export type DiscoveryRefreshMode = 'manual' | 'on-open' | 'background-if-stale' | 'startup'
export type ReadinessProbeKind = 'ollama-generation' | 'openai-compatible-models'

export interface ModelCatalogEntry {
  id: string
  apiName: string
  label?: string
  default?: boolean
  hidden?: boolean
  modelDescriptorId?: string
  capabilities?: CapabilityFlags
  contextWindow?: number
  maxOutputTokens?: number
  transportOverrides?: CatalogTransportOverrides
  notes?: string
}

export interface ModelCatalogConfig {
  source: ModelCatalogSource
  discovery?: ModelDiscoveryConfig
  discoveryCacheTtl?: DurationString | number
  discoveryRefreshMode?: DiscoveryRefreshMode
  allowManualRefresh?: boolean
  models?: ModelCatalogEntry[]
}

export type ModelDiscoveryKind = 'openai-compatible' | 'ollama' | 'custom'

export interface ModelDiscoveryConfig {
  kind: ModelDiscoveryKind
  requiresAuth?: boolean
  path?: string
  parse?: 'openai-models-list' | 'ollama-tags' | 'custom'
  mapModel?: (raw: unknown) => ModelCatalogEntry | null
}

export interface SetupMetadata {
  requiresAuth: boolean
  authMode: AuthMode
  credentialEnvVars?: string[]
  setupPrompt?: string
}

export interface StartupMetadata {
  autoDetectable?: boolean
  probeReadiness?: ReadinessProbeKind
  enablementEnvVar?: string
}

export interface UsageMetadata {
  supported: boolean
  delegateToVendorId?: string
  delegateToGatewayId?: string
  fetchModule?: string
  parseModule?: string
  ui?: {
    showResetCountdown?: boolean
    compactProgressBar?: boolean
    fallbackMessage?: string
  }
  silentlyIgnore?: boolean
}

export interface InvalidCredentialValue {
  envVar: string
  value: string
  message: string
}

export interface ValidationRoutingMetadata {
  enablementEnvVar?: string
  matchDefaultBaseUrl?: boolean
  matchBaseUrlHosts?: string[]
  fallbackWhenUseOpenAI?: boolean
  skipWhenUseOpenAI?: boolean
}

export interface ProviderPresetMetadata {
  id: string
  description: string
  label?: string
  name?: string
  vendorId?: string
  apiKeyEnvVars?: string[]
  baseUrlEnvVars?: string[]
  modelEnvVars?: string[]
  fallbackBaseUrl?: string
  fallbackModel?: string
}

export type ProviderPresetRouteKind =
  | 'vendor'
  | 'gateway'
  | 'anthropic-proxy'

export interface ProviderPresetManifestEntry {
  preset: string
  routeKind: ProviderPresetRouteKind
  routeId: string
  vendorId: string
  gatewayId?: string
  description: string
  label?: string
  name?: string
  apiKeyEnvVars?: readonly string[]
  baseUrlEnvVars?: readonly string[]
  modelEnvVars?: readonly string[]
  fallbackBaseUrl?: string
  fallbackModel?: string
}

export type ValidationMetadata =
  | {
      routing?: ValidationRoutingMetadata
      kind: 'credential-env'
      credentialEnvVars: string[]
      allowLocalBaseUrlWithoutCredential?: boolean
      missingCredentialMessage?: string
      invalidCredentialValues?: InvalidCredentialValue[]
    }
  | {
      routing?: ValidationRoutingMetadata
      kind: 'gemini-credential'
      missingCredentialMessage: string
    }
  | {
      routing?: ValidationRoutingMetadata
      kind: 'github-token'
      missingCredentialMessage: string
      expiredCredentialMessage: string
      invalidCredentialMessage: string
    }

export interface VendorDescriptor {
  id: string
  label: string
  classification: 'anthropic' | 'openai-compatible' | 'native'
  defaultBaseUrl: string
  defaultModel: string
  requiredEnvVars?: string[]
  validate?: (env: NodeJS.ProcessEnv) => string | null
  setup: SetupMetadata
  startup?: StartupMetadata
  isFirstParty?: boolean
  transportConfig: TransportConfig
  catalog?: ModelCatalogConfig
  usage?: UsageMetadata
  validation?: ValidationMetadata
  preset?: ProviderPresetMetadata
}

export interface GatewayDescriptor {
  id: string
  label: string
  vendorId?: string
  category?: 'local' | 'hosted' | 'aggregating'
  defaultBaseUrl?: string
  defaultModel?: string
  supportsModelRouting?: boolean
  setup: SetupMetadata
  startup?: StartupMetadata
  transportConfig: TransportConfig
  catalog?: ModelCatalogConfig
  usage?: UsageMetadata
  validation?: ValidationMetadata
  preset?: ProviderPresetMetadata
}

export interface AnthropicProxyDescriptor {
  id: string
  label: string
  classification: 'anthropic-proxy'
  defaultBaseUrl: string
  defaultModel: string
  requiredEnvVars?: string[]
  validate?: (env: NodeJS.ProcessEnv) => string | null
  setup: SetupMetadata
  startup?: StartupMetadata
  envVarConfig: {
    authTokenEnvVar: string
    baseUrlEnvVar: string
    modelEnvVar?: string
  }
  capabilities: CapabilityFlags
  transportConfig: TransportConfig
  catalog?: ModelCatalogConfig
  usage?: UsageMetadata
  validation?: ValidationMetadata
  preset?: ProviderPresetMetadata
}

export interface BrandDescriptor {
  id: string
  label: string
  canonicalVendorId: string
  defaultContextWindow?: number
  defaultMaxOutputTokens?: number
  defaultCapabilities: CapabilityFlags
  modelIds?: string[]
}

export interface ModelDescriptor {
  id: string
  label: string
  brandId?: string
  vendorId: string
  gatewayId?: string
  classification: ('chat' | 'reasoning' | 'vision' | 'coding')[]
  defaultModel: string
  providerModelMap?: Partial<Record<string, string>>
  capabilities: CapabilityFlags
  contextWindow?: number
  maxOutputTokens?: number
  cacheConfig?: CacheConfig
}

export interface RegistryValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}
