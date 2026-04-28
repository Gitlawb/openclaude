# Registry/Descriptor Architecture for Providers, Gateways, and Models

## Executive Summary

OpenClaude currently overloads the word "provider" across several different concerns:

- Vendor: OpenAI, Anthropic, Google, Moonshot
- Gateway: OpenRouter, Ollama, LM Studio, LiteLLM
- Model family: Claude, GPT, Kimi, Llama
- Anthropic proxy: third-party endpoints that accept Anthropic-native requests

That overload leaks into the codebase as duplicated switches, partially overlapping type systems, and routing behavior that is hard to extend safely.

This plan introduces a descriptor registry under `src/integrations/` so that:

- integration metadata lives in one place
- runtime routing can remain transport-specific (`openaiShim` vs native Anthropic)
- `/provider`, `--provider`, model lookup, validation, discovery, and `/usage` read from the same source of truth
- existing user config remains backward compatible
- future integrations can be added with additive descriptor files instead of scattered switch edits
- adding a new gateway is usually a one-file change, or a two-file change when it needs a large manual catalog

At a high level, the plan has five major components:

1. Defines a descriptor model for vendors, gateways, models, brands, and anthropic proxies.
2. Migrates current provider metadata into a shared registry while preserving existing runtime behavior.
3. Builds a per-route model discovery cache service (`src/integrations/discoveryCache.ts`) that supports TTL-based expiration, stale fallback, background refresh, and manual refresh for dynamic and hybrid catalogs.
4. Moves consumer surfaces onto descriptor-backed metadata in phases, with verification checkpoints between each phase.
5. Adds a dedicated documentation phase so the resulting architecture is teachable and maintainable for future contributors.

The plan includes the following execution details to support implementation and tracking:

- the rollout is broken into smaller work packets that multiple agents could tackle in parallel
- each work packet has a checklist so the plan can be used to track progress as well as describe intent
- the discovery cache service is scoped as a standalone work packet (Phase 2A.5) with its own interface, storage strategy, and tests
- the verification section is now a checklist-style test plan
- a dedicated documentation phase now covers contributor docs, worked samples, and `/usage` integration guidance
- all planned documentation is explicitly required to live under `/docs` in `.md` format

The plan intentionally remains conservative in a few areas where the current runtime behavior is not yet fully normalized:

- `github`, `bedrock`, `vertex`, and `mistral` still have runtime behavior that may need exception handling during migration
- backward compatibility is treated as both a typing problem and a runtime behavior problem, especially around stored provider profiles
- anthropic proxies are modeled as a first-class concept even though current implementation is centered on vendors and gateways

The intended end state is broader than simply replacing switch statements with descriptor objects:

- one authoritative metadata system
- clearer boundaries between metadata and transport
- a per-route discovery cache with TTL, stale fallback, background refresh, and manual refresh
- safer incremental migration
- contributor documentation with realistic examples for vendors, gateways, models, anthropic proxies, discovery caching, and `/usage`

The document is intentionally ordered as:

1. Problem and goals
2. Target architecture
3. Behavioral rules
4. Backward compatibility
5. Migration inventory
6. Rollout phases
7. Verification
8. Appendix and documentation deliverables

## Problem Statement

### Terminology Overload

The current "provider" concept conflates multiple distinct layers:

| Concept | Examples | Responsibility |
|---|---|---|
| Vendor | OpenAI, Anthropic, Google, Moonshot, DeepSeek | Auth mode, native API shape, canonical base URL |
| Gateway | OpenRouter, Ollama, LM Studio, Together, Groq | Proxying or hosting models behind an OpenAI-compatible or local interface |
| Model | Claude, GPT, Kimi, DeepSeek, Llama, Qwen | Capabilities, context windows, API names |
| Anthropic proxy | future third-party Anthropic-compatible endpoints | Anthropic-native transport through a non-Anthropic endpoint |

### Current Maintenance Burden

Adding or changing an integration currently requires editing many unrelated surfaces:

- `src/utils/providerFlag.ts`
- `src/utils/providerProfiles.ts`
- `src/utils/configConstants.ts`
- `src/utils/model/providers.ts`
- `src/utils/providerProfile.ts`
- `src/components/ProviderManager.tsx`
- `src/utils/providerValidation.ts`
- `src/utils/providerDiscovery.ts`
- `src/commands/provider/provider.tsx`

The result is drift between:

- profile presets
- CLI provider flags
- runtime provider detection
- startup env shaping
- model catalog behavior

### Existing Type Fragmentation

The repo currently has at least these overlapping systems:

- `ProviderPreset` in `src/utils/providerProfiles.ts`
- `APIProvider` in `src/utils/model/providers.ts`
- `ProviderFlagName` in `src/utils/providerFlag.ts`
- `Providers` in `src/utils/config.ts`
- `ProviderProfile` in both `src/utils/config.ts` and `src/utils/providerProfile.ts`

This is one of the main reasons new integrations keep requiring coordinated edits.

## Goals

### Primary Goals

- Separate vendor, gateway, model, and anthropic-proxy concerns.
- Centralize defaults, labels, setup metadata, usage support, and model metadata.
- Make new integrations additive instead of switch-driven.
- Keep gateway onboarding cheap:
  - a typical new gateway should be addable in `src/integrations/gateways/<id>.ts`
  - a gateway with a large manual catalog should usually need only one optional companion catalog file
- Treat descriptor-native onboarding as a hard requirement, not a documentation aspiration:
  - a preset-participating route must derive its loader registration, preset mapping, and `/provider` UI metadata from descriptor-authored data
  - if static typing or bundler constraints require generation, the only extra step may be regenerating checked-in artifacts, never hand-editing multiple metadata tables
- Preserve current transport behavior:
  - OpenAI-compatible flows continue through `src/services/api/openaiShim.ts`
  - Anthropic-native flows continue through the native Claude path
- Keep existing user config working without requiring migration.
- Avoid `/usage` support gaps during the migration.

### Non-Goals

- Replacing the OpenAI shim.
- Collapsing every runtime distinction into a single universal transport.
- Requiring users to rewrite `settings.json`.
- Redesigning the entire `/provider` UX in the first phase.

## Proposed Architecture

### Directory Layout

Introduce a descriptor-based registry at `src/integrations/`:

```text
src/integrations/
  descriptors.ts
  define.ts
  registry.ts
  index.ts
  compatibility.ts
  brands/
    claude.ts
    deepseek.ts
    gpt.ts
    kimi.ts
    llama.ts
    qwen.ts
  vendors/
    anthropic.ts
    openai.ts
    openai.models.ts
    gemini.ts
    moonshot.ts
    deepseek.ts
    deepseek.models.ts
    minimax.ts
    bankr.ts
  gateways/
    ollama.ts
    ollama.models.ts
    lmstudio.ts
    atomic-chat.ts
    openrouter.ts
    together.ts
    groq.ts
    mistral.ts
    azure-openai.ts
    github.ts
    bedrock.ts
    vertex.ts
    dashscope-cn.ts
    dashscope-intl.ts
    nvidia-nim.ts
    custom.ts
  anthropicProxies/
    # future anthropic-native third-party endpoints when needed
  models/
    claude.ts
    gpt.ts
    kimi.ts
    deepseek.ts
    llama.ts
    qwen.ts
```

Catalog ownership rules:

- route descriptors are the source of truth for which models a route exposes
- gateways are routes, so a gateway descriptor declares the gateway's supported model subset
- direct vendors may also be routes when they expose models directly, effectively acting as their own first-party gateway
- every gateway or direct-vendor route declares only the subset it actually supports; no route is assumed to support every model in the shared index
- gateways and direct vendors may declare default or recommended models where applicable
- `gateways/<id>.ts` should be enough for small catalogs
- `gateways/<id>.models.ts` is the optional spillover file for a large manual catalog or route-specific discovery function
- `vendors/<id>.ts` and optional `vendors/<id>.models.ts` follow the same pattern for vendors that expose their own hosted model catalog, such as OpenAI or DeepSeek
- shared files under `models/` act as a glossary/index for reusable metadata and optional route enrichment; they are not the default place to encode gateway or direct-vendor availability
- `src/integrations/index.ts` is the descriptor loader, but it must not become another hand-maintained provider switch
- the loader should be generated or use constrained directory discovery for known descriptor folders so adding a normal gateway remains a one-file or two-file change

Descriptor additivity rules:

- normal descriptor-backed routes must not require hand-edits in `src/integrations/index.ts`, `src/integrations/compatibility.ts`, `src/integrations/providerUiMetadata.ts`, or a separately maintained preset-id union
- if a route should appear in preset-driven `/provider` flows, that participation must be declared in descriptor-authored metadata, not a second manually maintained source of truth
- generated loader or preset-manifest files are acceptable only when they are derived from descriptor files and validated by tests

### Core Descriptor Types

```typescript
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

export interface OpenAIShimTransportConfig {
  headers?: Record<string, string>
  supportsAuthHeaders?: boolean
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
  supportsAuthHeaders?: boolean
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

export interface ModelCatalogEntry {
  id: string
  apiName: string
  label?: string
  default?: boolean
  recommended?: boolean
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

export type ModelDiscoveryKind =
  | 'openai-compatible'
  | 'ollama'
  | 'custom'

export interface ModelDiscoveryConfig {
  kind: ModelDiscoveryKind
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
  probeReadiness?: string
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

export interface VendorDescriptor {
  id: string
  label: string
  classification: 'anthropic' | 'openai-compatible' | 'native'
  defaultBaseUrl: string
  defaultModel: string | string[]
  requiredEnvVars?: string[]
  validate?: (env: NodeJS.ProcessEnv) => string | null
  setup: SetupMetadata
  startup?: StartupMetadata
  isFirstParty?: boolean
  transportConfig: TransportConfig
  catalog?: ModelCatalogConfig
  usage?: UsageMetadata
}

export interface GatewayDescriptor {
  id: string
  label: string
  category?: 'local' | 'hosted' | 'aggregating'
  defaultBaseUrl?: string
  supportsModelRouting?: boolean
  setup: SetupMetadata
  startup?: StartupMetadata
  transportConfig: TransportConfig
  catalog?: ModelCatalogConfig
  usage?: UsageMetadata
}

export interface AnthropicProxyDescriptor {
  id: string
  label: string
  classification: 'anthropic-proxy'
  defaultBaseUrl: string
  defaultModel: string | string[]
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
```

### Gateway-First Catalog Ownership

The common path should optimize for adding a gateway, not for perfectly normalizing every model family across every route.

Default rule:

- when adding a gateway, define the gateway and its offered model subset in the gateway descriptor
- if the gateway has too many static entries or needs model discovery, move only the model catalog and discovery function into `gateways/<id>.models.ts`
- when adding a direct vendor that exposes models itself, define the vendor and its offered model subset in the vendor descriptor
- if the vendor has too many static entries or needs model discovery, move only the model catalog and discovery function into `vendors/<id>.models.ts`
- only add or update `models/*.ts` when shared glossary metadata is genuinely useful

This keeps the common path cheap:

1. add `src/integrations/gateways/<id>.ts`
2. optionally add `src/integrations/gateways/<id>.models.ts`
3. for direct vendors, use the equivalent `src/integrations/vendors/<id>.ts` plus optional `src/integrations/vendors/<id>.models.ts`

Shared model descriptors remain valuable, but they should not force contributors to edit multiple model-family files just to say "this route offers these few models."

Discovery rule:

- normal route-specific discovery belongs in `gateways/<id>.models.ts` or `vendors/<id>.models.ts`
- descriptor files should import a single catalog object from that companion models file when discovery is needed
- discovery should be declarative for common protocols; contributors should not need to hand-write fetch/parsing/cache code for OpenAI-compatible `/v1/models`
- discovery details such as discovery kind, cache TTL, refresh mode, and curated model entries should live together in `<id>.models.ts`
- custom discovery functions are an escape hatch only, not the common path

One-file gateway example:

```typescript
export const acmeGateway: GatewayDescriptor = {
  id: 'acme',
  label: 'Acme AI',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.acme.example/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'acme-fast',
        apiName: 'acme/fast-chat',
        label: 'Acme Fast Chat',
        default: true,
        capabilities: { supportsStreaming: true },
        contextWindow: 128_000,
      },
      {
        id: 'deepseek-reasoner',
        apiName: 'deepseek/deepseek-reasoner',
        modelDescriptorId: 'deepseek-reasoner',
        recommended: true,
        transportOverrides: {
          openaiShim: {
            preserveReasoningContent: true,
            requireReasoningContentOnAssistantMessages: true,
            reasoningContentFallback: '',
          },
      },
    ],
  },
  usage: { supported: false },
}
```

The first entry is gateway-owned and needs no shared model descriptor. The second entry links to shared glossary metadata because that metadata is useful, but Acme still explicitly declares that it supports the model.

Vendor-as-gateway rule:

- a `VendorDescriptor` can own a catalog when the vendor is also the endpoint where users directly select and run models
- examples include `openai` and `deepseek`
- this does not require a duplicate gateway descriptor unless there is a distinct routing surface, proxy behavior, or user-facing preset that should be modeled separately

### Registry API

```typescript
const _brands = new Map<string, BrandDescriptor>()
const _vendors = new Map<string, VendorDescriptor>()
const _gateways = new Map<string, GatewayDescriptor>()
const _anthropicProxies = new Map<string, AnthropicProxyDescriptor>()
const _models = new Map<string, ModelDescriptor>()

export function registerBrand(d: BrandDescriptor): void { ... }
export function registerVendor(d: VendorDescriptor): void { ... }
export function registerGateway(d: GatewayDescriptor): void { ... }
export function registerAnthropicProxy(d: AnthropicProxyDescriptor): void { ... }
export function registerModel(d: ModelDescriptor): void { ... }

export function getBrand(id: string): BrandDescriptor | undefined { ... }
export function getVendor(id: string): VendorDescriptor | undefined { ... }
export function getGateway(id: string): GatewayDescriptor | undefined { ... }
export function getAnthropicProxy(id: string): AnthropicProxyDescriptor | undefined { ... }
export function getModel(id: string): ModelDescriptor | undefined { ... }

export function getAllBrands(): BrandDescriptor[] { ... }
export function getAllVendors(): VendorDescriptor[] { ... }
export function getAllGateways(): GatewayDescriptor[] { ... }
export function getAllAnthropicProxies(): AnthropicProxyDescriptor[] { ... }
export function getAllModels(): ModelDescriptor[] { ... }

export function getCatalogForGateway(gatewayId: string): ModelCatalogConfig | undefined { ... }
export function getCatalogForVendor(vendorId: string): ModelCatalogConfig | undefined { ... }
export function getCatalogEntriesForRoute(routeId: string): ModelCatalogEntry[] { ... }
export function getModelsForBrand(brandId: string): ModelDescriptor[] { ... }
export function getModelsForGateway(gatewayId: string): ModelDescriptor[] { ... } // enriched view over gateway catalog entries
export function getModelsForVendor(vendorId: string): ModelDescriptor[] { ... } // enriched view over direct-vendor catalog entries
export function getBrandsForVendor(vendorId: string): BrandDescriptor[] { ... }

export function validateIntegrationRegistry(): RegistryValidationResult { ... }
```

Catalog APIs are the authoritative source for `/model` population. `getModelsForGateway()` and `getModelsForVendor()` are convenience enrichers that join route catalog entries to shared model descriptors when possible; they must not invent support for every shared model.

Registry validation should fail tests for:

- duplicate ids within each descriptor map
- catalog entries whose `modelDescriptorId` points at a missing shared model descriptor
- catalog entries with duplicate ids within the same route
- static catalogs with no models unless explicitly marked as intentionally empty
- multiple default catalog entries unless the route explicitly supports multi-default selection
- unsupported transport/config combinations, such as OpenAI shim options on a route whose `transportConfig.kind` cannot use the OpenAI shim
- usage metadata that delegates to a missing vendor or gateway

### Descriptor Authoring Pattern

Descriptor files should not import registry functions or descriptor types directly in the common case.

Instead, `src/integrations/define.ts` exposes small typed helpers:

```typescript
export function defineVendor(d: VendorDescriptor): VendorDescriptor { return d }
export function defineGateway(d: GatewayDescriptor): GatewayDescriptor { return d }
export function defineAnthropicProxy(d: AnthropicProxyDescriptor): AnthropicProxyDescriptor { return d }
export function defineBrand(d: BrandDescriptor): BrandDescriptor { return d }
export function defineModel(d: ModelDescriptor): ModelDescriptor { return d }
export function defineCatalog(d: ModelCatalogConfig): ModelCatalogConfig { return d }
```

Example:

```typescript
// src/integrations/vendors/anthropic.ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'anthropic',
  label: 'Anthropic',
  classification: 'anthropic',
  defaultBaseUrl: 'https://api.anthropic.com',
  defaultModel: 'claude-sonnet-4-6',
  requiredEnvVars: ['ANTHROPIC_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ANTHROPIC_API_KEY'],
  },
  transportConfig: {
    kind: 'anthropic-native',
  },
  isFirstParty: true,
})
```

For catalog files:

```typescript
// src/integrations/gateways/hicap.models.ts
import { defineCatalog } from '../define.js'

export default defineCatalog({
  source: 'dynamic',
  discovery: { kind: 'openai-compatible' },
  discoveryCacheTtl: '1d',
  discoveryRefreshMode: 'background-if-stale',
  allowManualRefresh: true,
})
```

The registry owns registration. The loader imports descriptor modules, reads their default exports, validates their shape, and calls the internal register functions.

`src/integrations/index.ts` is the single loader entrypoint for descriptor modules. Runtime and tests should import this loader before reading registry state.

Loader rule:

- adding `gateways/<id>.ts` should not require editing consumer surfaces or scattered switch statements
- contributor-authored descriptor files should normally need only one helper import, such as `defineGateway` or `defineCatalog`
- contributor-authored descriptor files should not call `registerGateway`, `registerVendor`, or other registry functions directly
- contributor-authored descriptor files should not need `import type { GatewayDescriptor } ...` or `import type { ModelCatalogConfig } ...` in normal examples
- if the repo cannot safely use constrained descriptor-folder discovery at runtime, the loader should be generated by a small script and checked by tests
- manual loader edits are acceptable only as a temporary Phase 1 bootstrap, not as the end-state contributor workflow

### Compatibility Bridge

`src/integrations/compatibility.ts` maps legacy preset names to descriptors:

```typescript
export const PRESET_VENDOR_MAP: Array<{
  preset: ProviderPreset
  vendorId: string
  gatewayId?: string
}> = [
  { preset: 'anthropic', vendorId: 'anthropic' },
  { preset: 'openai', vendorId: 'openai' },
  { preset: 'ollama', vendorId: 'openai', gatewayId: 'ollama' },
  { preset: 'deepseek', vendorId: 'deepseek' },
]

export function vendorIdForPreset(preset: ProviderPreset): string { ... }
export function gatewayIdForPreset(preset: ProviderPreset): string | undefined { ... }
export function routeForPreset(preset: ProviderPreset): {
  vendorId: string
  gatewayId?: string
  routeId: string
} { ... }
```

End-state rule:

- `compatibility.ts` should become a thin derived view over descriptor-authored preset metadata, not a permanently hand-maintained preset-routing table
- `providerUiMetadata.ts` ordering, descriptions, env-var overrides, and display names for preset-driven routes should come from the same descriptor-authored metadata or from a generated manifest derived from it
- if `ProviderPreset` remains a closed type, it should be generated from descriptor-authored preset ids rather than maintained as a separate handwritten union

## Behavioral Rules

### Routing Model

Routing remains descriptor-driven but transport-specific:

- `transportConfig.kind === 'openai-compatible'` routes through `openaiShim`
- `transportConfig.kind === 'local'` routes through the local-provider path, usually via `openaiShim` plus local readiness/discovery affordances
- `transportConfig.kind === 'anthropic-native'` routes through the native Anthropic path
- `transportConfig.kind === 'anthropic-proxy'` also routes through the native Anthropic path, but with proxy-specific env var handling
- `transportConfig.kind === 'gemini-native'`, `'bedrock'`, or `'vertex'` preserves the existing dedicated runtime path until those transports are intentionally normalized
- `GatewayDescriptor` describes a routing layer in front of a vendor or model catalog, not a separate transport implementation
- `GatewayDescriptor.category` is optional display/grouping metadata only; runtime routing must not depend on it
- required gateway transport style should be expressed once through `transportConfig.kind`, not repeated through `targetVendorId` or `isOpenAICompatible`

This keeps the architecture clean:

- descriptors answer "what is this integration?"
- transport code answers "how do requests flow?"

### OpenAI Shim Provider Quirks

`src/services/api/openaiShim.ts` is expected to remain the OpenAI-compatible transport implementation, but the migration may still refactor it substantially.

The target is not to replace the shim. The target is to move provider and route-specific shim behavior out of hardcoded base URL checks and into descriptor-backed transport metadata.

Examples of shim behavior that should become descriptor-driven where practical:

- static headers and user-supplied custom headers
- model name resolution from the active route catalog
- max token field normalization for providers that require `max_completion_tokens`
- request body fields that a provider rejects or requires, such as `store`
- reasoning/thinking replay behavior such as `reasoning_content` preservation
- thinking request format differences, such as DeepSeek/Z.AI-style `{ thinking: { type: 'enabled' | 'disabled' } }`

Important compatibility note:

- PR #895 may land before or after this plan
- if it lands first, preserve its DeepSeek/Moonshot `reasoning_content` behavior while moving the gate from base URL checks to descriptor metadata where possible
- if it does not land first, the descriptor migration should still account for the same API contract: some OpenAI-compatible routes require `reasoning_content` to be present on every assistant message during thinking mode, even when empty
- this behavior may be route-specific or model-specific for gateways that host DeepSeek-like reasoning models, so it should not be inferred only from the direct DeepSeek base URL
- PR #896 may add Z.AI/GLM-specific OpenAI shim behavior before this plan lands; if so, migrate its max-token, store-stripping, thinking request format, and `reasoning_content` behavior into descriptor-backed transport/catalog metadata

### `/usage` Routing

`/usage` should become descriptor-driven, but the plan should point at the real command surface in this repo:

- command entry: `src/commands/usage/index.ts`
- shared usage fetchers already exist under `src/services/api/usage.ts` and related modules

Target behavior:

- provider-specific usage support is declared on descriptors
- unsupported providers render a neutral fallback
- gateways can delegate usage behavior to their linked vendor

Planned routing shape:

```typescript
function getUsageDescriptor(activeId: string) {
  const gateway = getGateway(activeId)
  if (gateway) {
    if (gateway.usage?.delegateToGatewayId) {
      return getGateway(gateway.usage.delegateToGatewayId)
    }
    if (gateway.usage?.delegateToVendorId) {
      return getVendor(gateway.usage.delegateToVendorId)
    }
    return gateway
  }
  return getVendor(activeId) ?? getAnthropicProxy(activeId)
}
```

Rules:

- Anthropic supports `/usage`
- MiniMax keeps its provider-specific `/usage` handling
- OpenAI-family gateways without a usage API show a neutral fallback unless they explicitly delegate to a supported vendor
- gateways with their own usage API should declare usage support on the gateway descriptor, not on the linked vendor
- custom providers default to unsupported and should never crash the command

### Model Lookup and Variant Handling

Model resolution should answer two separate questions:

1. is this model offered by the active gateway or vendor?
2. what metadata do we know about that model?

Availability should come from the active gateway or direct-vendor catalog first. Shared model descriptors are glossary/enrichment and fallback, not the authoritative source of provider availability.

Model metadata should resolve through a layered fallback chain:

```text
1. active gateway or direct-vendor catalog entry
2. provider-qualified descriptor: getModel(`${vendorId}:${modelId}`)
3. global descriptor: getModel(modelId)
4. legacy fallback: getOpenAIContextWindow(modelId)
5. hardcoded default context window
```

This preserves current utility from `src/utils/model/openaiContextWindows.ts` while keeping gateway onboarding cheap.

Catalog rules:

- `catalog.source === 'static'`: use the descriptor-declared model subset
- `catalog.source === 'dynamic'`: use runtime discovery for `/model` population
- `catalog.source === 'hybrid'`: merge discovery with descriptor-declared manual entries
- dynamic discovery failures should fall back to static/manual entries when present and render a non-crashing empty state when not
- hybrid merge rules should be deterministic: descriptor-declared entries win for labels, defaults, capabilities, context limits, and transport overrides; discovery can add extra models but should not override curated metadata
- defaults and recommendations should come from the active gateway or direct-vendor catalog, not be inferred from the global model index
- no gateway or direct vendor should be treated as implicitly supporting every model known to the system

### Model Discovery Cache and Refresh

Dynamic and hybrid catalogs need a cache so `/model` is responsive and so provider discovery failures do not break the picker.

Target behavior:

- discovery cache is stored per route id, not globally
- cache entries store `routeId`, `baseUrl`, `fetchedAt`, `models`, and optionally `etag` or provider-specific metadata
- default TTL should be conservative, such as `1d`, unless a descriptor overrides `discoveryCacheTtl`
- TTL should accept human-readable strings such as `30m`, `1h`, and `1d`; raw millisecond numbers remain allowed for edge cases
- `/model` should show cached discovered models immediately when available
- if cached data is stale and `discoveryRefreshMode === 'background-if-stale'`, refresh in the background and update the picker when the refresh succeeds
- if no cache exists, `/model` may show curated static entries first while discovery loads
- if discovery fails, keep stale cached models and curated static entries rather than clearing the picker
- discovered models should be marked as discovered/generated metadata so the UI can distinguish them from curated defaults when useful

Refresh mode options:

- `manual`: never refresh automatically; only refresh when the user runs `/model refresh` or uses the picker refresh action
- `on-open`: when the user opens `/model` and the cache is stale, block briefly for refresh before rendering discovered entries, while still falling back to cached/manual entries on failure
- `background-if-stale`: when the user opens `/model`, show cached/manual entries immediately and refresh stale discovery data in the background
- `startup`: refresh stale discovery data during app startup or provider activation, useful only for fast/local providers where startup cost is acceptable

Recommended default:

- use `background-if-stale` for hosted gateways because it keeps `/model` responsive while still discovering newly added provider models
- use `manual` for slow, rate-limited, or flaky providers
- use `on-open` only when a fresh model list is more important than instant picker rendering
- use `startup` sparingly because it can make app startup feel slower

Manual refresh requirements:

- add `/model refresh` to force refresh for the active route
- add an in-picker refresh action, such as pressing `r`, to force refresh without leaving the picker
- manual refresh bypasses TTL but still preserves old cache data if the request fails
- manual refresh should show a clear success, failure, or "no changes found" status
- manual refresh should never require editing descriptors or restarting OpenClaude

Suggested cache shape:

```typescript
export interface ModelDiscoveryCacheEntry {
  routeId: string
  baseUrl?: string
  fetchedAt: string
  models: ModelCatalogEntry[]
  etag?: string
  error?: {
    message: string
    occurredAt: string
  }
}
```

Example HiCap-style hybrid catalog:

```typescript
catalog: {
  source: 'hybrid',
  discovery: {
    kind: 'openai-compatible',
  },
  discoveryCacheTtl: '1d',
  discoveryRefreshMode: 'background-if-stale',
  allowManualRefresh: true,
  models: hicapCuratedModels,
}
```

End-user model freshness story:

1. provider adds a model
2. user opens `/model`
3. OpenClaude shows cached and curated entries immediately
4. if the route cache is stale, discovery refreshes in the background
5. the new model appears after refresh, even if no shared `models/*.ts` descriptor exists yet
6. if the user wants it immediately, they run `/model refresh` or use the picker refresh action

Stored model compatibility rules:

- existing profiles may store an API model string rather than a catalog entry id
- catalog resolution should first try exact catalog `id`, then exact `apiName`, then shared model descriptor lookup, then legacy context-window fallback
- when a stored model resolves by `apiName`, the system should preserve the stored value for API calls while using the catalog entry for display and metadata
- unknown custom-provider models should continue to work without catalog entries, using legacy metadata fallback and safe defaults

Two valid model-variant patterns:

1. Vendor-prefixed descriptor IDs
2. Shared model ID with provider-qualified lookup

Either is acceptable as long as:

- the API model string remains explicit
- the display label is unambiguous
- context window overrides are deterministic

### Brand / Vendor / Gateway / Model Layering

The intended conceptual stack is:

```text
BRAND            -> optional shared model-family identity
VENDOR/GATEWAY   -> routing endpoint
ROUTE CATALOG    -> models exposed by that gateway or direct vendor, including defaults
MODEL INDEX      -> shared glossary/enrichment metadata
PROFILE          -> user-selected saved configuration
```

Key relationships:

| Relationship | Meaning |
|---|---|
| Gateway -> Catalog entries | a gateway declares the subset it exposes and which entries are defaults or recommended |
| Direct vendor -> Catalog entries | a vendor may declare its own first-party model catalog when it is also the model endpoint |
| Catalog entry -> Shared model descriptor | a route catalog entry may link to shared glossary metadata, but does not require it |
| Model -> Brand | a shared model descriptor may belong to one brand |
| Brand -> Canonical Vendor | a brand may have a canonical vendor |
| Model -> Vendor | a shared model descriptor may have a canonical origin |
| Model -> providerModelMap | shared glossary metadata can still express provider-specific API names |
| ProviderProfile -> Vendor/Gateway | user config selects the route |

### Custom Providers and Custom Headers

Custom OpenAI-compatible providers should remain possible without adding a descriptor.

Baseline rules:

- save them as OpenAI-compatible profiles
- use `getOpenAIContextWindow(modelName)` when possible
- fall back to the global default when the model is unknown
- allow optional custom headers through descriptor-supported UI
- store user-supplied custom headers on the profile, not on the shared descriptor
- merge headers in this order: descriptor static headers, profile custom headers, request-specific headers
- reject or redact unsafe header names and never log secret header values

Planned wizard flow for custom providers:

1. choose custom OpenAI-compatible provider
2. enter base URL
3. enter model name
4. optionally enter API key
5. optionally enter custom headers

## Backward Compatibility

### Existing Config Files Must Keep Working

Users with existing `providerProfiles` in config must not need to rewrite anything.

Current stored shape:

```typescript
providerProfiles?: Array<{
  id: string
  name: string
  provider: Providers
  baseUrl: string
  model: string
  apiKey?: string
  customHeaders?: Record<string, string>
}>
activeProviderProfileId?: string
```

### Type Strategy

Planned type direction:

```typescript
// current
export type Providers = typeof PROVIDERS[number]

// target
export type Providers = string
```

Rationale:

- current config files may already contain provider strings outside the closed union
- runtime validation should happen through descriptor lookup, not through a compile-time closed list

### Important Compatibility Caveat

This is not only a type change.

Current behavior in `src/utils/providerProfiles.ts` also sanitizes unknown profile providers back to `'openai'`. The rollout must account for that or the backward-compat goal is only partially true.

That means Phase 1 needs to update all of the following together:

- `Providers` typing in `src/utils/config.ts`
- profile sanitization behavior in `src/utils/providerProfiles.ts`
- runtime env application in `applyProviderProfileToProcessEnv()`

### Fallback Rules

If a stored provider value is unknown at runtime:

- the profile must still deserialize
- descriptor lookup may return `undefined`
- fallback behavior should be explicit and documented
- fallback should be safe, ideally OpenAI-compatible, but not silent in a way that hides real misconfiguration

Profile route-resolution rules:

- existing `profile.provider` values may be legacy preset names, vendor ids, gateway ids, or custom strings
- resolution should try compatibility preset mapping first, then direct vendor id, then gateway id, then safe unknown-provider fallback
- the active route should resolve to `{ vendorId, gatewayId?, routeId }` so consumers do not each reinterpret the same profile string
- do not rewrite stored profile values simply because a descriptor mapping now exists; preserve user config unless a future explicit settings migration is introduced

## Migration Inventory

All currently supported integrations should be represented in descriptors before descriptor-driven behavior becomes authoritative.

| Preset | Type | Canonical Vendor | Gateway | Usage | Notes |
|---|---|---|---|---|---|
| `anthropic` | vendor | `anthropic` | - | yes | native Anthropic |
| `openai` | direct vendor route | `openai` | - | no | owns first-party model catalog where needed; no native usage API |
| `gemini` | vendor | `gemini` | - | no | separate auth/runtime path |
| `mistral` | gateway/provider surface | `openai` or `mistral` decision must be finalized | `mistral` | no | current repo treats it as dedicated runtime provider |
| `moonshotai` | direct vendor route | `moonshot` | - | no | OpenAI-compatible; may own first-party catalog if direct model choices are surfaced |
| `deepseek` | direct vendor route | `deepseek` | - | no | owns first-party model catalog; DeepSeek models may also appear in gateway catalogs |
| `zai` | direct vendor route | `zai` | - | no | add if PR #896 lands; OpenAI-compatible GLM Coding Plan with DeepSeek-compatible thinking format |
| `together` | gateway | `openai` | `together` | no | multi-brand host |
| `groq` | gateway | `openai` | `groq` | no | multi-brand host |
| `azure-openai` | gateway | `openai` | `azure-openai` | no | deployment-based naming |
| `openrouter` | gateway | `openai` | `openrouter` | no | multi-brand host |
| `lmstudio` | gateway | `openai` | `lmstudio` | no | local |
| `ollama` | gateway | `openai` | `ollama` | no | local |
| `nvidia-nim` | gateway/provider surface | `openai` | `nvidia-nim` | no | signaled today by `NVIDIA_NIM` |
| `minimax` | vendor | `minimax` | - | yes | signaled today by `MINIMAX_API_KEY`; catalog ownership depends on final native/proxy shape |
| `bankr` | direct vendor route | `bankr` | - | no | OpenAI-compatible; may own first-party catalog if direct model choices are surfaced |
| `dashscope-cn` | gateway | `openai` | `dashscope-cn` | no | Qwen-family |
| `dashscope-intl` | gateway | `openai` | `dashscope-intl` | no | Qwen-family |
| `github` | gateway/provider surface | `openai` | `github` | no | special native-Claude path for Claude models today |
| `bedrock` | gateway/provider surface | provider mapping may stay special | `bedrock` | no | Anthropic transport differences matter |
| `vertex` | gateway/provider surface | provider mapping may stay special | `vertex` | no | Anthropic transport differences matter |
| `atomic-chat` | gateway | `openai` | `atomic-chat` | no | local |
| `custom` | gateway | `openai` | `custom` | no | user supplied |

Notes:

- the table above is intentionally a planning inventory, not a final schema guarantee
- a blank Gateway column only means "no separate `GatewayDescriptor`"; direct vendors can still own route catalogs on their `VendorDescriptor`
- some current runtime providers (`bedrock`, `vertex`, `github`, `mistral`) have behavior that is more nuanced than a simple "gateway linked to openai"
- those edge cases should be resolved before descriptor routing becomes authoritative

## Rollout Plan

### Phase 1: Foundation and Parity

Goal:

- establish the descriptor system without regressing current behavior
- get all metadata into one place before deeper runtime migration starts

Exit criteria:

- registry exists and loads
- every currently supported integration has descriptor coverage
- preset defaults and `/usage` can read from descriptors
- existing saved profiles still deserialize and activate

Recommended sequence:

- [ ] land the registry skeleton first
- [ ] land descriptor inventory second
- [ ] land first-wave consumers third
- [ ] land parity tests and cleanup for Phase 1 last

Phase 1 work packets:

#### Phase 1A: Registry Skeleton

Scope:

- create `src/integrations/descriptors.ts`
- create `src/integrations/define.ts`
- create `src/integrations/registry.ts`
- create `src/integrations/index.ts`
- create `src/integrations/compatibility.ts`
- define the initial descriptor interfaces and registration helpers
- define registry validation helpers for descriptor integrity
- define the loader strategy so normal gateway additions do not require hand-editing an import list

Suggested owner:

- Agent 1

Deliverables:

- base descriptor types
- lightweight `define*` authoring helpers
- register/get/list APIs
- explicit descriptor loader
- registry validation API
- compatibility helpers for legacy preset names
- documented loader strategy: constrained discovery, generated index, or temporary manual bootstrap

Dependencies:

- none; this is the bootstrap packet for the rest of the phase

Tracking checklist:

- [ ] create `src/integrations/descriptors.ts`
- [ ] create `src/integrations/define.ts`
- [ ] create `src/integrations/registry.ts`
- [ ] create `src/integrations/index.ts`
- [ ] create `src/integrations/compatibility.ts`
- [ ] define the initial descriptor interfaces
- [ ] add `defineVendor`, `defineGateway`, `defineCatalog`, `defineModel`, `defineBrand`, and `defineAnthropicProxy` helpers
- [ ] implement register/get/list APIs
- [ ] implement registry validation APIs
- [ ] add compatibility helpers for legacy preset names
- [ ] add a test that proves a new gateway descriptor can be picked up without editing consumer code

#### Phase 1B: Descriptor Inventory for Vendors and Gateways

Scope:

- add vendor descriptors
- add gateway descriptors
- add anthropic proxy descriptors where needed
- assign `transportConfig.kind` for every route descriptor
- ensure every gateway and direct model-serving vendor declares a catalog strategy:
  - static catalog in descriptor data
  - dynamic discovery
  - hybrid discovery plus manual additions

Suggested owner split:

1. Agent 1: first-party and direct vendors (`anthropic`, `openai`, `gemini`, `moonshot`, `deepseek`, `minimax`, `bankr`, and `zai` if PR #896 lands)
2. Agent 2: gateways and local providers (`ollama`, `lmstudio`, `atomic-chat`, `openrouter`, `together`, `groq`, `custom`, `azure-openai`, `dashscope-*`, `nvidia-nim`)
3. Agent 3: special-case provider surfaces (`github`, `bedrock`, `vertex`, `mistral`) with explicit notes on unresolved routing nuances

Deliverables:

- one descriptor file per integration surface
- route-owned model subsets for every gateway and direct model-serving vendor
- usage metadata filled in for each supported or unsupported provider
- unresolved edge cases documented inline where behavior is not yet fully normalized

Dependencies:

- Phase 1A

Tracking checklist:

- [ ] add vendor descriptor files for first-party and direct vendors
- [ ] add gateway descriptor files for hosted and local providers
- [ ] add anthropic proxy descriptor files where needed
- [ ] assign `transportConfig.kind` for every vendor, gateway, and anthropic proxy
- [ ] declare catalog strategy for every gateway and direct model-serving vendor (`static`, `dynamic`, or `hybrid`)
- [ ] add static or hybrid catalog entries for routes whose `/model` population is incomplete or absent
- [ ] verify each gateway lists only the subset of models it actually supports
- [ ] verify direct model-serving vendors such as `openai` and `deepseek` list only the subset they actually support
- [ ] fill in `usage` metadata for each supported or unsupported provider
- [ ] document unresolved routing exceptions inline for `github`, `bedrock`, `vertex`, and `mistral`
- [ ] confirm no currently supported integration is missing from the inventory

#### Phase 1C: Shared Brand and Model Index Seeding

Scope:

- add brand descriptors where shared model-family identity is useful
- add initial shared model index files
- encode provider-specific model aliases via `providerModelMap` where shared metadata adds value

Suggested owner split:

1. Agent 1: brand descriptors and brand-level defaults
2. Agent 2: shared model index families (`claude`, `gpt`, `kimi`, `deepseek`, `llama`, `qwen`)

Deliverables:

- initial brand registry
- initial shared model index
- documented fallback behavior to `openaiContextWindows.ts` for anything not yet modeled
- explicit guidance that gateway and direct-vendor onboarding should not normally require edits to multiple shared model files

Dependencies:

- Phase 1A
- can run in parallel with Phase 1B after the base descriptor types exist

Tracking checklist:

- [ ] add brand descriptor files where shared model-family identity is useful
- [ ] add initial shared model index files
- [ ] encode provider-specific model aliases via `providerModelMap` where shared metadata warrants it
- [ ] document fallback behavior to `openaiContextWindows.ts`
- [ ] confirm initial shared model index coverage is sufficient for first-wave consumers
- [ ] confirm new gateway onboarding still works as a one-file or two-file change in the common case
- [ ] confirm new direct-vendor onboarding follows the same one-file or two-file catalog pattern where applicable

#### Phase 1D: Config and Preset Compatibility

Scope:

- update `src/utils/config.ts`
- update `src/utils/providerProfiles.ts`
- preserve config compatibility for existing `providerProfiles`

Tracking checklist:

- [ ] widen `Providers` typing strategy
- [ ] stop normalizing unknown stored providers back to `openai`
- [ ] make preset lookup read from `compatibility.ts` plus descriptors
- [ ] add a single profile route-resolution helper that returns `{ vendorId, gatewayId?, routeId }`
- [ ] ensure `applyProviderProfileToProcessEnv()` has explicit fallback behavior
- [ ] verify existing `providerProfiles` still deserialize unchanged

Suggested owner:

- Agent 1

Dependencies:

- Phase 1A
- should coordinate with Phase 1B because compatibility mapping needs real descriptor ids

#### Phase 1E: CLI Flag and Usage Surface Migration

Scope:

- update `src/utils/providerFlag.ts`
- update `/usage` command surfaces under `src/commands/usage/`

Tracking checklist:

- [ ] derive valid provider names from descriptor-backed metadata or compatibility helpers
- [ ] preserve current env-shaping semantics for `--provider`
- [ ] add descriptor-driven usage routing
- [ ] preserve clear fallback behavior for unsupported providers
- [ ] verify unsupported providers do not silently disappear from user-facing flows unless intended

Suggested owner split:

1. Agent 1: `providerFlag.ts`
2. Agent 2: `/usage` command routing and fallback behavior

Dependencies:

- Phase 1A
- Phase 1B for provider inventory

#### Phase 1F: Phase-1 Verification and Merge Pass

Scope:

- tighten tests around descriptor loading, preset mapping, config compatibility, and `/usage`
- validate no provider was omitted from descriptor inventory

Tracking checklist:

- [ ] add registry unit tests
- [ ] add registry validation tests for duplicate ids, broken references, invalid delegates, and unsupported transport/config combinations
- [ ] add compatibility mapping tests
- [ ] add saved-profile compatibility tests
- [ ] add `/usage` routing tests
- [ ] run provider and model/provider test suites
- [ ] validate no provider was omitted from descriptor inventory

Suggested owner:

- Agent 1

Dependencies:

- Phases 1B through 1E

Phase 1 merge checkpoints:

- [ ] merge Phase 1A first
- [ ] merge 1B and 1C once descriptor ids are stable
- [ ] merge 1D and 1E after inventory stabilizes
- [ ] merge 1F last

Phase 1 requirement:

- [ ] no provider is left without descriptor coverage if descriptor-driven `/usage` or preset metadata becomes active

### Phase 2: Runtime Metadata Adoption

Goal:

- move decision-making logic onto descriptors so runtime surfaces stop duplicating provider rules

Exit criteria:

- validation, discovery hints, preset metadata, and runtime affordances are descriptor-backed
- UI and command surfaces read shared metadata instead of bespoke switches

Recommended sequence:

- [ ] migrate read-only metadata consumers first
- [ ] migrate env/routing helpers second
- [ ] retire duplicated logic only after parity is verified

Phase 2 work packets:

#### Phase 2A: Validation Metadata Migration

Scope:

- move validation behavior from `src/utils/providerValidation.ts` into descriptors where appropriate

Tracking checklist:

- [ ] inventory current validation rules by provider
- [ ] classify which rules are pure metadata and which are true runtime logic
- [ ] move metadata-like rules into descriptors
- [ ] keep truly procedural rules in helper functions where needed
- [ ] route validation entry points through descriptor-backed metadata

Suggested owner:

- Agent 1

Dependencies:

- Phase 1 complete

#### Phase 2A.5: Discovery Cache Service

Scope:

Build the reusable per-route model discovery cache module before discovery metadata migration begins consuming it. This is the write-path counterpart to the cache behavior described in "Model Discovery Cache and Refresh."

Deliverables:

- `src/integrations/discoveryCache.ts` — core service
- `src/integrations/discoveryCache.test.ts` — unit tests

Interface:

- `getCachedModels(routeId, ttlMs)` — returns entry or `null` if missing/stale
- `setCachedModels(routeId, entry)` — overwrites entry, clears error state
- `recordDiscoveryError(routeId, error)` — preserves stale data, appends error metadata
- `isCacheStale(routeId, ttlMs)` — boolean check
- `clearDiscoveryCache(routeId?)` — per-route or global clear
- `parseDurationString(input)` — human-readable `30m`/`1h`/`1d` → ms, accepts raw numbers

Storage strategy (reuse proven patterns from `src/utils/statsCache.ts`):

- **File**: `join(getClaudeConfigHomeDir(), 'model-discovery-cache.json')`
- **Atomic writes**: temp file + `rename` with `fsync`
- **Locking**: in-memory promise queue (`withDiscoveryCacheLock`)
- **Versioning**: `DISCOVERY_CACHE_VERSION` + `migrateDiscoveryCache`
- **Corruption fallback**: empty cache, no crash
- **Why not `envPaths('claude-cli').cache`**: that cache is scoped to `cwd`; model discovery must survive across project directories

Stale fallback rules:

1. Discovery succeeds → overwrite cache, clear error
2. Discovery fails + stale cache exists → keep stale cache, append error
3. Discovery fails + no cache → store error only; `getCachedModels` returns `null`
4. Hybrid catalog static entries → always shown regardless of cache state
5. Manual refresh (`/model refresh`, in-picker `r`) → bypasses TTL, still preserves stale data on failure

Tracking checklist:

- [ ] create `src/integrations/discoveryCache.ts`
- [ ] create `src/integrations/discoveryCache.test.ts`
- [ ] implement `parseDurationString` with `m`, `h`, `d` support and raw numbers
- [ ] implement `getCachedModels`, `setCachedModels`, `isCacheStale`
- [ ] implement `recordDiscoveryError` with stale-data preservation
- [ ] implement `clearDiscoveryCache` (per-route and all-routes)
- [ ] implement atomic writes (temp + rename)
- [ ] implement in-memory locking for concurrent access
- [ ] implement schema version + migration stub
- [ ] implement corruption fallback (empty cache, no crash)
- [ ] verify parse and TTL behavior in unit tests
- [ ] verify atomic write does not corrupt existing cache on crash mid-write
- [ ] verify concurrent writes are serialized
- [ ] verify `recordDiscoveryError` preserves stale cache data

Suggested owner:

- Agent 1 (registry/discovery track)

Dependencies:

- Phase 1A (descriptor types exist, especially `ModelCatalogEntry`)
- Phase 1B (route IDs are stable)
- Can be developed in parallel with Phase 2A

Merge checkpoint:

- [ ] merge as standalone PR before Phase 2B begins

#### Phase 2B: Discovery and Readiness Metadata Migration

Scope:

- move readiness/probe hints from `src/utils/providerDiscovery.ts` into descriptor metadata
- implement descriptor-backed model discovery and per-route discovery caching for dynamic and hybrid catalogs

Tracking checklist:

- [ ] map current readiness flows for Ollama, Atomic Chat, and other local/openai-compatible providers
- [ ] define which probe behaviors can be declared as metadata
- [ ] keep actual probe execution in code, but drive probe selection from descriptors
- [ ] add a model discovery service that can run declarative `catalog.discovery` configs
- [ ] consume `discoveryCache.ts` in the discovery service (depends on Phase 2A.5)
- [ ] wire `setCachedModels` / `getCachedModels` into declarative `catalog.discovery` execution
- [ ] implement deterministic hybrid merge behavior where curated descriptor entries override discovered metadata
- [ ] implement built-in `discovery.kind: 'openai-compatible'` support for standard `/v1/models` discovery
- [ ] ensure OpenAI-compatible discovery uses the route's base URL and descriptor/profile-resolved headers automatically
- [ ] reserve custom discovery functions for non-standard response shapes only
- [ ] verify local provider labels still render correctly
- [ ] verify readiness messages still render correctly

Suggested owner:

- Agent 1

Dependencies:

- Phase 1 complete
- Phase 2A.5 (discovery cache service must exist before wiring discovery into it)

#### Phase 2C: Provider UI Metadata Migration

Scope:

- update `src/components/ProviderManager.tsx`
- update `src/commands/provider/provider.tsx`
- update `/model` picker and command flow to consume route catalogs and model discovery cache

Tracking checklist:

- [ ] replace hardcoded preset labels/defaults with descriptor lookups
- [ ] drive auth/setup prompts from descriptor metadata
- [ ] wire custom-header capability flags into the custom-provider flow
- [ ] make `/model` read active route catalog entries instead of global model availability
- [ ] call `getCachedModels` before rendering `/model` for dynamic/hybrid routes so cached discovered models appear immediately
- [ ] call `isCacheStale` to trigger background refresh when picker opens
- [ ] add `/model refresh` command to force model discovery refresh for the active route
- [ ] add an in-picker refresh action for model discovery, such as pressing `r`
- [ ] call `clearDiscoveryCache(routeId)` from `/model refresh` and in-picker refresh handlers
- [ ] show non-blocking refresh states: loading, success, failure with stale cache, and no changes found
- [ ] surface `entry.error` in the picker UI when refresh failed but stale data exists
- [ ] keep any UX-only branching that is truly presentational
- [ ] verify the `/provider` experience remains understandable after metadata migration

Suggested owner split:

1. Agent 1: `ProviderManager.tsx`
2. Agent 2: `/provider` command flow

Dependencies:

- Phase 1A through 1E complete
- Phase 2A.5 (discovery cache service must exist for `/model` picker to consume it)

#### Phase 2D: Runtime Provider Detection Alignment

Scope:

- align `src/utils/model/providers.ts` and related runtime helpers with the new descriptor world
- begin moving OpenAI-compatible transport quirks in `src/services/api/openaiShim.ts` toward descriptor-backed metadata without replacing the shim

Tracking checklist:

- [ ] define the boundary between `APIProvider` and descriptor ids
- [ ] decide which legacy runtime provider names stay externally visible
- [ ] map descriptor-backed state onto `getAPIProvider()` without breaking existing callers
- [ ] inventory current `openaiShim.ts` provider/base-url conditionals and classify which can become descriptor metadata
- [ ] preserve DeepSeek/Moonshot `reasoning_content` replay behavior from PR #895 if it has landed
- [ ] if PR #895 has not landed, explicitly test whether the migration still covers its reported DeepSeek thinking-mode edge cases
- [ ] preserve Z.AI GLM Coding Plan behavior from PR #896 if it has landed
- [ ] move Z.AI-style `max_tokens`, `store` stripping, thinking request format, and `reasoning_content` gates into descriptor metadata where possible
- [ ] avoid assuming DeepSeek-like reasoning behavior only applies to direct DeepSeek URLs; gateways may expose models with the same requirement
- [ ] document exceptions such as `github`, `bedrock`, `vertex`, and `mistral`
- [ ] verify existing callers still receive expected provider categories

Suggested owner:

- Agent 1

Dependencies:

- Phase 1 complete
- should coordinate closely with Phase 2A and 2B

#### Phase 2E: Phase-2 Verification and Drift Audit

Scope:

- confirm descriptor-backed runtime behavior matches pre-migration behavior

Tracking checklist:

- [ ] run `/provider` flows for representative providers
- [ ] verify validation errors still appear at the right times
- [ ] verify local discovery still works
- [ ] audit remaining switch statements
- [ ] document whether each remaining switch is intentional or stale

Suggested owner:

- Agent 1

Dependencies:

- Phase 2A through 2D

Phase 2 merge checkpoints:

- [ ] merge validation metadata changes first (Phase 2A)
- [ ] merge discovery cache service second (Phase 2A.5)
- [ ] merge discovery and readiness metadata changes third (Phase 2B)
- [ ] merge UI/command consumers fourth (Phase 2C)
- [ ] merge runtime provider detection changes fifth (Phase 2D)
- [ ] merge drift-audit cleanup last (Phase 2E)

### Phase 3: Cleanup

Goal:

- remove transitional duplication once descriptor-backed behavior is trusted

Exit criteria:

- obsolete switch chains are removed
- compatibility shims are minimized and clearly named
- remaining exceptions are intentional and documented

Phase 3 work packets:

#### Phase 3A: Dead Switch Removal

Scope:

- remove obsolete switch/case chains from provider metadata surfaces

Tracking checklist:

- [ ] identify every switch made redundant by descriptors
- [ ] remove only the switches proven obsolete by tests
- [ ] keep a short migration note in commit/PR text for anything user-visible

Suggested owner:

- Agent 1

Dependencies:

- Phase 2 complete

#### Phase 3B: Type and Naming Consolidation

Scope:

- reduce overlapping provider-related types and aliases

Tracking checklist:

- [ ] decide which legacy names remain public API
- [ ] keep compatibility aliases where callers still rely on them
- [ ] rename internal helpers where descriptor terminology is clearer

Suggested owner:

- Agent 1

Dependencies:

- Phase 2D complete

#### Phase 3C: Env-Shaping Consolidation

Scope:

- simplify duplicated provider-specific env shaping across startup/profile helpers
- consolidate descriptor-driven OpenAI-compatible shim options after behavior parity is proven

Tracking checklist:

- [ ] compare `providerProfiles.ts`, `providerProfile.ts`, and startup env builders
- [ ] centralize the parts that can now be safely descriptor-driven
- [ ] replace eligible `openaiShim.ts` base URL/provider conditionals with descriptor-backed transport config
- [ ] keep `reasoning_content` preservation behavior intact for routes that require it
- [ ] add or retain regression coverage for assistant messages with thinking blocks, no thinking blocks, string content, tool calls, and synthetic interrupt messages
- [ ] preserve special-case behavior where transport contracts still differ

Suggested owner:

- Agent 1

Dependencies:

- Phase 2 complete

#### Phase 3D: Final Audit and Documentation Pass

Scope:

- confirm the architecture now matches the plan
- capture remaining intentional exceptions

Tracking checklist:

- [ ] inventory all provider-specific special cases still left in the repo
- [ ] classify them as intentional, temporary, or missed migration work
- [ ] update the architecture note with final constraints and known exceptions

Suggested owner:

- Agent 1

Dependencies:

- Phase 3A through 3C

#### Phase 3E: Descriptor-Native Onboarding Closure

Scope:

- eliminate the remaining hand-maintained onboarding surfaces that keep descriptor authoring from being truly additive
- make preset-driven `/provider` participation descriptor-owned instead of split across loader, compatibility, and UI tables

Tracking checklist:

- [ ] choose and implement the sustainable loader strategy: constrained descriptor-folder discovery or generated loader artifacts
- [ ] remove the need to hand-edit `src/integrations/index.ts` for normal descriptor-backed routes
- [ ] define descriptor-owned preset metadata for routes that should appear in preset-driven `/provider` flows
- [ ] derive `routeForPreset()` and related compatibility helpers from descriptor-authored preset metadata or a generated manifest derived from it
- [ ] derive provider preset ordering, descriptions, display labels/names, and env-var override metadata from the same descriptor-authored source
- [ ] eliminate or generate any separate handwritten preset-id union so preset typing cannot drift from descriptor reality
- [ ] add validation for duplicate preset ids, incomplete preset metadata, and descriptor routes that opt into presets without sufficient UI/config data
- [ ] add tests that prove a representative preset-participating gateway can be added with descriptor file changes only, or descriptor file changes plus regeneration of derived artifacts, with no hand-edits to unrelated consumer tables
- [ ] add equivalent tests for a representative direct model-serving vendor
- [ ] keep an explicit opt-out path for descriptor routes that should not appear as presets

Suggested owner split:

1. Agent 1: loader/preset-manifest design and implementation
2. Agent 2: `/provider` consumer migration and validation coverage

Dependencies:

- Phase 2 complete
- should land before Phase 4 docs claim fully additive onboarding as branch reality

Phase 3 merge checkpoints:

- [ ] merge dead-switch removal in small PRs
- [ ] merge type consolidation separately from runtime behavior changes
- [ ] merge env-shaping consolidation after targeted regression tests
- [ ] merge descriptor-native onboarding closure before declaring the docs fully end-state accurate
- [ ] merge final audit/doc updates last

### Phase 4: Documentation and Reference Samples

Goal:

- produce implementation-quality documentation for the descriptor system
- provide future contributors with reliable reference examples for the most common integration patterns

Exit criteria:

- docs explain how to add each descriptor type
- docs include detailed worked samples for multiple gateway and vendor patterns
- docs explain when and how `/usage` should be attached to a vendor or gateway
- docs clearly call out the difference between metadata, routing, and transport behavior
- all documentation lives under `/docs`
- all documentation is written in `.md` format
- docs are organized into a clear, maintainable `/docs` structure

Recommended sequence:

- [ ] document the architecture and terminology first
- [ ] document add-a-new-integration workflows second
- [ ] add worked reference samples third
- [ ] add `/usage` integration guidance and review docs for accuracy last

Phase 4 work packets:

#### Phase 4A: Documentation Structure and Terminology

Scope:

- create a stable docs structure for the new integration architecture
- define the shared vocabulary contributors should use

Suggested owner:

- Agent 1

Dependencies:

- Phase 1 complete
- preferably after most of Phase 2 so terminology reflects actual implementation

Tracking checklist:

- [ ] ensure all new documentation lives under `/docs`
- [ ] ensure all documentation files are `.md`
- [ ] choose the target doc locations
- [ ] add a top-level architecture document for descriptors and registry behavior
- [ ] define standard terminology for vendor, gateway, model, brand, and anthropic proxy
- [ ] document the boundary between descriptor metadata and transport implementation
- [ ] document that `transportConfig.kind` is the routing contract for gateways
- [ ] document that gateway `category` is optional display/grouping metadata and must not drive runtime routing
- [ ] document the descriptor authoring pattern using `defineVendor`, `defineGateway`, `defineCatalog`, `defineModel`, `defineBrand`, and `defineAnthropicProxy`
- [ ] document that loader-owned registration means contributors should not call registry functions directly in normal descriptor files
- [ ] document the compatibility layer and legacy naming expectations

Suggested doc outputs:

- `docs/architecture/integrations.md`
- `docs/integrations/overview.md`
- `docs/integrations/glossary.md`

#### Phase 4B: "How To Add a Vendor" and "How To Add a Gateway" Guides

Scope:

- write contributor guides for adding new vendors and gateways
- include multiple gateway variants rather than a single nominal pattern

Suggested owner split:

1. Agent 1: vendor documentation
2. Agent 2: gateway documentation

Dependencies:

- Phase 1 complete

Tracking checklist:

- [ ] write a step-by-step guide for adding a new vendor
- [ ] write a step-by-step guide for adding a new gateway
- [ ] keep all vendor and gateway guides under `/docs` as Markdown files
- [ ] include a vendor example with direct OpenAI-compatible routing
- [ ] include a vendor example that acts as its own first-party model endpoint with a catalog, such as OpenAI or DeepSeek
- [ ] include a gateway example that is addable in one file
- [ ] include a gateway example that uses an optional `gateways/<id>.models.ts` companion file for a large manual catalog or discovery function
- [ ] ensure examples use `defineGateway` and `defineCatalog` rather than direct registry/type imports
- [ ] explicitly show default exports from descriptor files and catalog files
- [ ] explicitly avoid `registerGateway`, `registerVendor`, and direct `import type` boilerplate in contributor-facing examples
- [ ] show `transportConfig.kind: 'openai-compatible'` for hosted OpenAI-compatible gateways
- [ ] show `transportConfig.kind: 'local'` for local gateways such as Ollama or LM Studio
- [ ] show `transportConfig.kind: 'anthropic-proxy'` for Anthropic-compatible proxy gateways
- [ ] explain the difference between `max_tokens` and `max_completion_tokens` for OpenAI-compatible routes
- [ ] document when to set `openaiShim.maxTokensField: 'max_tokens'`
- [ ] document when to set `openaiShim.maxTokensField: 'max_completion_tokens'`
- [ ] include examples for strict OpenAI-compatible providers that reject the wrong max-token field, such as Z.AI-style routes
- [ ] explain `category: 'local' | 'hosted' | 'aggregating'` as optional grouping only
- [ ] include a gateway example that exposes only its own hosted models
- [ ] include a gateway example that hosts a mixed catalog of third-party brands/models
- [ ] include a gateway example with `catalog.source: 'dynamic'`
- [ ] include a gateway example with `catalog.source: 'hybrid'`
- [ ] include a gateway example with discovery implemented in `gateways/<id>.models.ts`, human-readable discovery cache TTL, refresh mode, and manual refresh enabled
- [ ] document `discoveryCacheTtl` with examples such as `30m`, `1h`, and `1d`
- [ ] document each `discoveryRefreshMode` option with when to use it
- [ ] include examples for `manual`, `on-open`, `background-if-stale`, and `startup`
- [ ] include a gateway example whose hosted models differ in reasoning/thinking support, context window, input limits, and output limits
- [ ] include a gateway example with required static custom headers
- [ ] include guidance for optional user-supplied custom headers
- [ ] avoid redundant gateway examples that use `targetVendorId` or `isOpenAICompatible`; use `transportConfig.kind` instead
- [ ] document descriptor-owned preset metadata and the loader/preset-manifest workflow for preset-driven routes
- [ ] do not instruct contributors to hand-edit `src/integrations/index.ts`, `src/integrations/compatibility.ts`, or `src/integrations/providerUiMetadata.ts` for normal descriptor-backed routes

Suggested doc outputs:

- `docs/integrations/how-to/add-vendor.md`
- `docs/integrations/how-to/add-gateway.md`

Required sample patterns:

- vendor with standard API key auth
- vendor with custom static headers
- vendor that owns a first-party model catalog
- gateway addable in one file
- gateway addable in two files because it needs a large manual catalog or discovery function
- gateway with only first-party models
- gateway with mixed hosted models and `providerModelMap`
- gateway transport examples for `openai-compatible`, `local`, and `anthropic-proxy`
- gateway max-token-field examples for legacy/common `max_tokens` providers and newer OpenAI/Azure-style `max_completion_tokens` providers
- gateway with static catalog because discovery is unavailable
- gateway with hybrid catalog because discovery is incomplete
- gateway with dynamic discovery, stale cache fallback, `/model refresh`, and in-picker refresh
- gateway discovery TTL examples: `30m` for fast-changing catalogs, `1h` for moderately active providers, `1d` for stable hosted gateways
- gateway refresh-mode examples: `manual` for flaky/rate-limited providers, `on-open` for routes that need fresh lists, `background-if-stale` for most hosted gateways, `startup` for fast local providers
- gateway whose models differ in reasoning/thinking behavior and context/input/output limits
- gateway with custom header requirements
- gateway examples must not use removed fields such as `targetVendorId`, `isOpenAICompatible`, or routing-oriented gateway `classification`

#### Phase 4C: "How To Add a Model" and "How To Add an Anthropic Proxy" Guides

Scope:

- document the remaining descriptor types with enough detail for contributors to extend them confidently

Suggested owner split:

1. Agent 1: model documentation
2. Agent 2: anthropic proxy documentation

Dependencies:

- Phase 1 complete

Tracking checklist:

- [ ] write a step-by-step guide for adding a model descriptor
- [ ] keep all model and anthropic proxy guides under `/docs` as Markdown files
- [ ] ensure model and anthropic proxy examples use `defineModel` and `defineAnthropicProxy`
- [ ] explain that shared model descriptors act primarily as glossary/index metadata and optional route enrichment
- [ ] explain when to add a brand descriptor versus only a model descriptor
- [ ] document `providerModelMap` with concrete examples
- [ ] explain model lookup priority and fallback to `openaiContextWindows.ts`
- [ ] explain why adding a gateway or direct-vendor catalog should not normally require editing multiple shared model files
- [ ] write a step-by-step guide for adding an anthropic proxy descriptor
- [ ] document Anthropic-specific env var contracts and routing expectations
- [ ] explain how anthropic proxies differ from OpenAI-compatible gateways

Suggested doc outputs:

- `docs/integrations/how-to/add-model.md`
- `docs/integrations/how-to/add-anthropic-proxy.md`

Required sample patterns:

- model attached to a canonical vendor only
- model shared across multiple route catalogs using `providerModelMap`
- anthropic proxy using Anthropic-native auth and base URL configuration

#### Phase 4D: `/usage` Integration Guide for Vendors and Gateways

Scope:

- document how `/usage` support should be implemented, when it should be attached to a vendor versus a gateway, and what fallbacks should look like

Suggested owner:

- Agent 1

Dependencies:

- Phase 1E complete
- ideally after Phase 2 runtime routing has stabilized

Tracking checklist:

- [ ] keep the `/usage` guide under `/docs` as a Markdown file
- [ ] document the `usage` field on vendor, gateway, and anthropic proxy descriptors
- [ ] explain when `/usage` belongs on the vendor descriptor
- [ ] explain when a gateway should delegate usage to a linked vendor
- [ ] explain when a gateway should define its own usage handling because it has its own usage API
- [ ] document required fetch/parse module structure for supported usage integrations
- [ ] document fallback behavior for unsupported providers
- [ ] include one worked vendor `/usage` example
- [ ] include one worked gateway `/usage` example
- [ ] include one worked unsupported-provider fallback example
- [ ] ensure `/usage` examples follow the `define*` authoring style and do not call registry functions directly

Suggested doc outputs:

- `docs/integrations/how-to/add-usage-support.md`

Required sample patterns:

- vendor with native usage API
- gateway that delegates usage behavior to a linked vendor
- gateway with its own usage API
- unsupported provider with neutral fallback behavior

#### Phase 4E: Reference Sample Pack and Docs Review

Scope:

- build a polished set of reference snippets and validate that the written docs match the implemented architecture

Suggested owner split:

1. Agent 1: sample pack assembly
2. Agent 2: docs review and accuracy pass

Dependencies:

- Phase 4A through 4D

Tracking checklist:

- [ ] keep the sample pack and contributor notes under `/docs` as Markdown files
- [ ] gather the best sample snippets into one reference pack
- [ ] verify samples are internally consistent with descriptor interfaces
- [ ] verify samples use `define*` helpers and default exports rather than direct registry/type imports
- [ ] verify gateway samples use `transportConfig.kind` for routing and only use `category` for optional grouping
- [ ] verify no sample uses removed gateway fields such as `targetVendorId` or `isOpenAICompatible`
- [ ] verify samples explain `max_tokens` versus `max_completion_tokens` and use `openaiShim.maxTokensField` where needed
- [ ] verify samples use the correct repo paths and current command surfaces
- [ ] verify `/usage` examples reflect actual routing rules
- [ ] remove or mark any sample that is intentionally illustrative rather than copy-paste ready
- [ ] add a short "common pitfalls" section for contributors

Suggested doc outputs:

- `docs/integrations/reference-samples.md`
- `docs/integrations/common-pitfalls.md`

Phase 4 merge checkpoints:

- [ ] merge architecture and glossary docs first
- [ ] merge vendor/gateway/model/proxy how-to guides second
- [ ] merge `/usage` integration guide third
- [ ] merge the final sample pack and docs-review fixes last

### Suggested Parallelization Strategy

If multiple agents are working at once, the safest split is by write-scope:

1. Registry core: `src/integrations/descriptors.ts`, `registry.ts`, `compatibility.ts`
2. Descriptor inventory: files under `src/integrations/vendors/`, `gateways/`, `brands/`, `models/`
3. Discovery cache service: `src/integrations/discoveryCache.ts` and tests
4. Config compatibility: `src/utils/config.ts`, `src/utils/providerProfiles.ts`
5. CLI/runtime surfaces: `src/utils/providerFlag.ts`, `src/utils/model/providers.ts`, `src/utils/providerDiscovery.ts`
6. UI and command consumers: `src/components/ProviderManager.tsx`, `src/commands/provider/provider.tsx`, `src/commands/usage/`
7. Test and audit work: `*.test.ts` plus migration verification
8. Documentation work: `docs/architecture/`, `docs/integrations/`, and reference sample docs

Guardrails for parallel work:

- stabilize descriptor ids before parallel consumer migration
- avoid having multiple agents edit the same consumer file in the same wave
- treat `github`, `bedrock`, `vertex`, and `mistral` as explicitly owned exception tracks
- prefer small merge checkpoints between phases instead of one long-lived branch
- keep documentation examples aligned with the implemented descriptor interfaces and actual repo paths

## Current Repo Touchpoints

These are the highest-value touchpoints based on current repo structure:

- `src/utils/providerProfiles.ts`
- `src/utils/providerProfile.ts`
- `src/utils/providerFlag.ts`
- `src/utils/providerDiscovery.ts`
- `src/utils/model/providers.ts`
- `src/utils/model/openaiContextWindows.ts`
- `src/services/api/openaiShim.ts`
- `src/utils/conversationRecovery.ts`
- `src/utils/thinking.ts`
- `src/components/ProviderManager.tsx`
- `src/commands/provider/provider.tsx`
- `src/commands/usage/index.ts`

Important current-state notes:

- `getAPIProvider()` today still returns a closed `APIProvider` union
- MiniMax is currently detected by presence of `MINIMAX_API_KEY`
- NVIDIA NIM is currently detected by `NVIDIA_NIM`
- unknown stored providers are currently normalized away in profile sanitization
- `src/commands/usage/usage.ts` is not the right path to cite in this repo; use `src/commands/usage/`
- `openaiShim.ts` contains provider/base-url-specific OpenAI-compatible transport behavior that may move behind descriptor metadata during Phase 2/3
- `conversationRecovery.ts` may interact with thinking/reasoning preservation because stripping thinking blocks too early prevents the shim from reconstructing provider-specific `reasoning_content`

## Open PR Conflict Check

### PR #890

`Feat/ollama cloud integration` overlaps heavily with this plan because it touches several of the same provider surfaces:

- `providerProfiles.ts`
- `providerFlag.ts`
- `providerProfile.ts`
- `providerDiscovery.ts`
- `ProviderManager.tsx`
- `provider.tsx`

If this plan lands after #890:

- Ollama Cloud must be migrated into descriptors as part of Phase 1

If this plan lands before #890:

- that PR should target descriptors directly instead of adding more switch logic

### PR #885

Touches unrelated MCP/tooling surfaces. No meaningful conflict.

### PR #886

Documentation-only. No meaningful conflict.

### PR #895

`fix: Preserve reasoning_content for DeepSeek edge-case assistant messages` overlaps with this plan because it touches OpenAI-compatible transport behavior:

- `src/services/api/openaiShim.ts`
- `src/utils/conversationRecovery.ts`
- `src/utils/conversationRecovery.hooks.test.ts`

This PR is compatible with the descriptor architecture, but it should be treated as a migration checkpoint because the plan may refactor `openaiShim.ts` conditionals into descriptor-backed transport metadata.

If this plan lands after #895:

- preserve the PR's `reasoning_content` behavior during any `openaiShim.ts` refactor
- move the gating from direct base URL checks to descriptor metadata where practical
- keep the recovery behavior that avoids stripping thinking blocks before the shim can translate them

If this plan lands before #895:

- ensure descriptor-backed shim behavior covers the same DeepSeek thinking-mode edge cases
- add or keep focused tests for assistant messages with array content but no thinking block, string content, tool calls, and synthetic interrupted-tool messages
- avoid hardcoding the behavior only to direct DeepSeek URLs because gateways may host models with the same `reasoning_content` contract

### PR #896

`feat(zai): add Z.AI GLM Coding Plan provider preset` overlaps heavily with this plan because it adds a new OpenAI-compatible route using the current switch-driven provider architecture.

Touched surfaces include:

- `src/utils/providerProfiles.ts`
- `src/utils/providerFlag.ts`
- `src/utils/providerDiscovery.ts`
- `src/components/ProviderManager.tsx`
- `src/components/StartupScreen.ts`
- `src/services/api/openaiShim.ts`
- `src/utils/model/openaiContextWindows.ts`
- `src/utils/thinking.ts`
- `src/utils/zaiProvider.ts`
- `.env.example`

If this plan lands after #896:

- migrate `zai` into a `VendorDescriptor` or direct vendor route descriptor during Phase 1
- move GLM model metadata into a Z.AI catalog and/or shared model index entries instead of leaving it only in `openaiContextWindows.ts`
- move Z.AI provider labels, preset defaults, CLI flag behavior, and startup display into descriptor-backed metadata
- preserve Z.AI OpenAI-shim quirks: `max_tokens`, `store` stripping, DeepSeek-compatible thinking request format, and `reasoning_content` preservation
- replace `isZaiBaseUrl()` base URL checks with descriptor-backed transport/catalog metadata where possible

If this plan lands before #896:

- that PR should target descriptors directly instead of adding another provider switch track
- Z.AI should be addable as a direct vendor route with `transportConfig.kind: 'openai-compatible'`
- GLM model support should live in the route catalog/shared model index, not only in the flat OpenAI context-window table
- thinking support should be declared via model capabilities and transport config instead of `thinking.ts` URL/model conditionals

## Follow-Up Work (Out of Scope)

The items in this section are intentionally out of scope for the descriptor migration plan itself. They should be tracked as follow-on work once the metadata architecture and migration are stable.

### `/provider` UX Revisit

Objective:

- make provider onboarding easier to understand and less error-prone for end users

Potential follow-up tasks:

- [ ] revisit the `/provider` onboarding flow with a stronger beginner-first design
- [ ] move optional setup paths to explicit opt-in flows rather than opt-out prompts where appropriate
- [ ] reduce cognitive load in first-run provider selection
- [ ] revisit wording, defaults, and progressive disclosure for advanced options
- [ ] validate the revised flow with common user journeys such as OpenAI-compatible custom providers, local providers, and first-party Anthropic

### `/usage` Refresh

Objective:

- revisit the `/usage` experience after descriptor-backed routing is complete

Potential follow-up tasks:

- [ ] refresh the `/usage` UX and presentation
- [ ] review whether unsupported-provider fallbacks should be more informative or more compact
- [ ] revisit refresh/loading behavior and perceived responsiveness
- [ ] evaluate whether provider-specific usage details should surface more clearly in the command
- [ ] align any `/usage` UX updates with the descriptor-driven usage model introduced by this plan

### `/model` Refresh

Objective:

- revisit the `/model` experience after descriptor-backed model metadata is available

Potential follow-up tasks:

- [ ] refresh the `/model` picker UX
- [ ] revisit how model capabilities, reasoning/thinking support, and context limits are presented
- [ ] evaluate whether brand, vendor, and gateway relationships should be surfaced more explicitly
- [ ] revisit filtering, grouping, and labeling once descriptor-backed model metadata is in place
- [ ] validate the updated `/model` UX against both simple providers and mixed-catalog gateways

### `settings.json` Revision

Objective:

- design a future config revision that better matches the descriptor architecture introduced here

Potential follow-up tasks:

- [ ] define a next-generation `settings.json` shape that aligns with vendor/gateway/model distinctions
- [ ] review how provider profiles, active selections, and model metadata should be represented in config long term
- [ ] decide what migration story would be required for any future config-schema revision
- [ ] evaluate whether legacy provider fields should be deprecated, aliased, or preserved indefinitely
- [ ] keep any future config revision explicitly separate from the compatibility requirements of this migration plan

## Verification

### Existing Tests to Keep Green

- provider tests under `src/utils/*provider*.test.ts`
- model/provider tests under `src/utils/model/*.test.ts`
- any `/provider` and startup-profile tests already covering env shaping

Suggested targeted runs:

- [ ] run provider-focused tests
- [ ] run model/provider resolution tests
- [ ] run profile startup/env tests

### Behavioral Verification

- [ ] every current preset still renders in `/provider`
- [ ] existing saved provider profiles still load
- [ ] `--provider ollama` still works
- [ ] `--provider minimax` still works
- [ ] local detection for Ollama and Atomic Chat still behaves correctly
- [ ] `/usage` either renders real data or a clear fallback for every provider
- [ ] custom providers never crash model lookup or `/usage`
- [ ] adding a representative new gateway can be done in one file, or two files when it needs a large manual catalog
- [ ] adding that representative gateway does not require hand-editing `src/integrations/index.ts`, `src/integrations/compatibility.ts`, `src/integrations/providerUiMetadata.ts`, provider flags, provider profiles, `/provider`, `/model`, `/usage`, or shim switch logic
- [ ] adding a representative direct model-serving vendor follows the same one-file or two-file catalog pattern where applicable
- [ ] a representative preset-participating gateway appears in `/provider` flows from descriptor-authored metadata alone, or from descriptor-authored metadata plus regeneration of derived artifacts
- [ ] preset ids, preset ordering, preset UI copy, and preset route mappings cannot drift from descriptor-authored metadata without failing validation/tests
- [ ] no gateway is treated as implicitly supporting every model in the shared model index
- [ ] no direct vendor is treated as implicitly supporting every model in the shared model index
- [ ] dynamic `/model` discovery shows cached entries immediately when available
- [ ] stale dynamic `/model` discovery refreshes in the background without blocking the picker
- [ ] `/model refresh` bypasses cache TTL for the active route
- [ ] in-picker model refresh bypasses cache TTL for the active route
- [ ] failed discovery refresh preserves stale cached entries and curated static entries
- [ ] newly discovered provider models appear without requiring descriptor edits or restart

### Migration-Specific Checks

- [ ] verify MiniMax still gets current quota UI behavior
- [ ] verify GitHub special cases are not regressed
- [ ] verify Bedrock and Vertex are not accidentally collapsed into OpenAI-compatible routing where Anthropic-native behavior is still required
- [ ] check whether PR #895 has landed before refactoring `openaiShim.ts`
- [ ] verify DeepSeek/Moonshot-style `reasoning_content` replay still works after descriptor-driven shim changes
- [ ] verify thinking blocks are not stripped from recovered conversations before provider-specific shim conversion can run
- [ ] verify gateways can declare reasoning-content preservation requirements independently of direct vendor base URLs
- [ ] check whether PR #896 has landed before refactoring provider presets, `openaiShim.ts`, `thinking.ts`, or model context metadata
- [ ] verify Z.AI/GLM `max_tokens`, `store` stripping, thinking request format, context windows, and max output tokens are preserved if PR #896 lands

## Design Decisions

### Why descriptors instead of more helper functions?

Because the main problem is not missing utility code. It is missing data ownership.

Descriptors give us:

- a single place for labels, defaults, and capabilities
- additive integration onboarding
- fewer switch statements
- clearer boundaries between metadata and transport

### Why multiple descriptor types?

Because the runtime contracts are genuinely different:

- vendors need auth and canonical API defaults
- gateways need readiness/discovery metadata
- anthropic proxies need Anthropic-specific env contracts
- models need capability and context-window metadata

A single descriptor type would force unrelated fields onto every integration.

### Why constrain descriptor loading?

The gateway-add path should stay cheap, but the registry should not become hidden magic.

The preferred end state is:

- descriptor files export typed descriptor objects through `define*` helpers
- the loader only scans or imports known descriptor directories under `src/integrations/`
- the loader owns registration into the registry
- registry validation catches broken ids, missing references, and invalid combinations
- tests prove that adding a gateway does not require editing unrelated consumer files

If runtime directory discovery is not compatible with the build, use a generated loader file instead of asking contributors to maintain another switch table by hand.

### Why require broad migration coverage in Phase 1?

Because partial migration creates split-brain behavior:

- some providers read from descriptors
- others still read from switches
- `/usage`, preset defaults, and validation drift again

Phase 1 does not have to solve every runtime nuance, but it does need to establish one authoritative metadata source.

## Appendix: Reference Examples

These examples belong at the end of the document so they do not interrupt the main proposal.

### Example A: OpenAI-compatible vendor with custom headers

Useful for future integrations where request headers are static and vendor-specific.

Key point:

- keep request header behavior in descriptor data, not conditionals scattered through `openaiShim`

### Example B: Route-owned catalog with shared model index enrichment

Useful when a gateway or vendor has:

- custom model names
- custom context windows
- custom cache limits
- no reliable runtime discovery for `/model` population

Key point:

- the common path should keep the offered model subset with the gateway or direct-vendor integration itself, while shared `models/*.ts` remain glossary/index metadata and optional route enrichment

### Example C: Anthropic proxy

Useful for future providers that:

- accept Anthropic-native requests
- use Anthropic-style auth/base-url env vars
- route through the native Anthropic path rather than the OpenAI shim

Key point:

- this is a different transport contract and deserves its own descriptor type
