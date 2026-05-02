# Integration Reference Samples

## Purpose

This file gathers the safest descriptor-era sample patterns into one place.

Use it when you want a quick starting point after reading:

- `docs/architecture/integrations.md`
- `docs/integrations/glossary.md`
- the relevant how-to guide under `docs/integrations/how-to/`

All samples here are implementation-aligned with the current implementation, but most
of them are still illustrative patterns. Replace ids, env vars, labels, and
URLs with real route-specific values before shipping them.

## Accuracy notes

This pack was reviewed against the current implementation surface:

- helper imports come from `src/integrations/define.ts`
- descriptor field shapes come from `src/integrations/descriptors.ts`
- generated loader/preset artifacts come from
  `src/integrations/generated/integrationArtifacts.generated.ts`
- route/profile compatibility docs reference `src/integrations/profileResolver.ts`
- route/default/provider label behavior references `src/integrations/routeMetadata.ts`
- runtime request-shaping notes reference `src/integrations/runtimeMetadata.ts`
- provider selection UI metadata derives from the generated preset manifest
  through `src/integrations/providerUiMetadata.ts`
- discovery caching behavior references `src/integrations/discoveryCache.ts` and
  `src/integrations/discoveryService.ts`
- `/usage` routing notes reference `src/commands/usage/index.ts` and the
  current settings UI in `src/components/Settings/Usage.tsx`

## Sample 1: Minimal direct vendor

Status: Illustrative pattern. Adapt ids, env vars, and URL before use.

Use when:

- the route is the canonical first-party vendor endpoint;
- the route is directly selectable;
- no companion catalog file is needed.

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme',
  label: 'Acme AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme.example/v1',
  defaultModel: 'acme-chat',
  requiredEnvVars: ['ACME_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  usage: {
    supported: false,
  },
})
```

Why this is safe:

- it uses `defineVendor` plus a default export;
- it keeps routing on `transportConfig.kind`;
- it makes `/provider` API mode and auth/header editing behavior explicit;
- it does not call registry mutation helpers directly.

## Sample 2: Direct vendor with a first-party catalog

Status: Illustrative pattern. Safe shape, but catalog contents are placeholder data.

Use when:

- the vendor directly serves multiple models;
- the route should own its offered subset;
- the route should point entries at shared model descriptors for model-specific
  runtime metadata.

```ts
import { defineCatalog, defineVendor } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'acme-fast',
      apiName: 'acme-fast',
      label: 'Acme Fast',
      modelDescriptorId: 'acme-fast',
    },
    {
      id: 'acme-reasoner',
      apiName: 'acme-reasoner',
      label: 'Acme Reasoner',
      modelDescriptorId: 'acme-reasoner',
      capabilities: {
        supportsReasoning: true,
      },
      transportOverrides: {
        openaiShim: {
          preserveReasoningContent: true,
          requireReasoningContentOnAssistantMessages: true,
          reasoningContentFallback: '',
        },
      },
    },
  ],
})

export default defineVendor({
  id: 'acme-first-party',
  label: 'Acme First-Party',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme-first-party.example/v1',
  defaultModel: 'acme-fast',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_FIRST_PARTY_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
      maxTokensField: 'max_completion_tokens',
    },
  },
  catalog,
  usage: {
    supported: false,
  },
})
```

Note:
Use `openaiShim.maxTokensField: 'max_completion_tokens'` when the route should
follow the newer hosted OpenAI-style contract. The route's `defaultModel`
selects the default; catalog entries should not add separate `default` or
`recommended` flags.

## Sample 3: Local gateway with dynamic discovery

Status: Illustrative pattern. Matches the current discovery schema and
local-route shape.

Use when:

- the route is local;
- discovery should populate the catalog dynamically;
- startup probing is cheap enough to be useful.

```ts
import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'acme-local',
  label: 'Acme Local',
  category: 'local',
  defaultBaseUrl: 'http://localhost:11434/v1',
  defaultModel: 'acme-local:latest',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'none',
  },
  startup: {
    autoDetectable: true,
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'local',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
    },
  },
  catalog: {
    source: 'dynamic',
    discovery: {
      kind: 'openai-compatible',
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'startup',
    allowManualRefresh: true,
  },
  usage: {
    supported: false,
  },
})
```

Notes:

- `category: 'local'` is descriptive only.
- `transportConfig.kind: 'local'` is the actual routing contract.
- `maxTokensField: 'max_tokens'` is the right pattern for local and other
  legacy-shaped OpenAI-compatible routes.

## Sample 4: Hosted gateway with a hybrid catalog in two files

Status: Illustrative pattern. This is the recommended large-catalog or
discovery-heavy gateway shape.

`src/integrations/gateways/galaxy.models.ts`

```ts
import { defineCatalog } from '../define.js'

export default defineCatalog({
  source: 'hybrid',
  discovery: {
    kind: 'openai-compatible',
  },
  discoveryCacheTtl: '1h',
  discoveryRefreshMode: 'background-if-stale',
  allowManualRefresh: true,
  models: [
    {
      id: 'galaxy-curated-default',
      apiName: 'galaxy/gpt-5-mini',
      label: 'GPT-5 Mini (via Galaxy)',
      modelDescriptorId: 'gpt-5-mini',
    },
    {
      id: 'galaxy-curated-reasoner',
      apiName: 'galaxy/deepseek-r1',
      label: 'DeepSeek R1 (via Galaxy)',
      modelDescriptorId: 'deepseek-reasoner',
      capabilities: {
        supportsReasoning: true,
      },
      transportOverrides: {
        openaiShim: {
          preserveReasoningContent: true,
          requireReasoningContentOnAssistantMessages: true,
          reasoningContentFallback: '',
        },
      },
    },
  ],
})
```

`src/integrations/gateways/galaxy.ts`

```ts
import { defineGateway } from '../define.js'
import catalog from './galaxy.models.js'

export default defineGateway({
  id: 'galaxy',
  label: 'Galaxy Gateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.galaxy.example/v1',
  defaultModel: 'galaxy/gpt-5-mini',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['GALAXY_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: true,
      maxTokensField: 'max_completion_tokens',
    },
  },
  catalog,
  usage: {
    supported: false,
  },
})
```

Notes:

- this is the right pattern for `discoveryCache.ts` plus `discoveryService.ts`;
- `background-if-stale` is the normal hosted-gateway choice when cached models
  should appear immediately and refresh in the background;
- `allowManualRefresh: true` is the shape that supports `/model refresh` and
  the in-picker refresh flow in the current implementation.

## Sample 5: Shared model descriptor with `providerModelMap`

Status: Illustrative pattern. Good for reusable shared-model metadata.

Use when:

- the same conceptual model appears on multiple routes;
- route catalogs should share one model identity;
- route-specific API names still need to be explicit.

```ts
import { defineModel } from '../define.js'

export default [
  defineModel({
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    brandId: 'deepseek',
    vendorId: 'deepseek',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: 'deepseek-reasoner',
    providerModelMap: {
      deepseek: 'deepseek-reasoner',
      openrouter: 'deepseek/deepseek-r1',
      galaxy: 'galaxy/deepseek-r1',
    },
    capabilities: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  }),
]
```

Important boundary:
`providerModelMap` records route-specific names. It does not declare route
availability by itself. The route catalog still owns the offered subset.

## Sample 6: Anthropic proxy

Status: Illustrative pattern. Matches the current descriptor interface even
though the repo does not yet ship concrete anthropic-proxy descriptors.

```ts
import { defineAnthropicProxy } from '../define.js'

export default defineAnthropicProxy({
  id: 'acme-anthropic-proxy',
  label: 'Acme Anthropic Proxy',
  classification: 'anthropic-proxy',
  defaultBaseUrl: 'https://anthropic-proxy.acme.example',
  defaultModel: 'claude-sonnet-4-5',
  requiredEnvVars: ['ACME_ANTHROPIC_PROXY_TOKEN'],
  setup: {
    requiresAuth: true,
    authMode: 'token',
    credentialEnvVars: ['ACME_ANTHROPIC_PROXY_TOKEN'],
  },
  envVarConfig: {
    authTokenEnvVar: 'ACME_ANTHROPIC_PROXY_TOKEN',
    baseUrlEnvVar: 'ACME_ANTHROPIC_PROXY_BASE_URL',
    modelEnvVar: 'ACME_ANTHROPIC_PROXY_MODEL',
  },
  capabilities: {
    supportsStreaming: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
  },
  transportConfig: {
    kind: 'anthropic-proxy',
  },
  usage: {
    supported: false,
  },
})
```

Note:
Treat this as an Anthropic-family transport contract, not as a generic
OpenAI-compatible gateway with different headers.

## Sample 7: `/usage` patterns

Status: Illustrative patterns. The metadata shapes are current, but runtime
support is still limited to the existing resolver/UI paths in the current
implementation.

Vendor-owned usage:

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme',
  label: 'Acme AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme.example/v1',
  defaultModel: 'acme-chat',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  usage: {
    supported: true,
    fetchModule: './usage/fetchAcmeUsage.js',
    parseModule: './usage/parseAcmeUsage.js',
  },
})
```

Gateway delegating to a vendor:

```ts
import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'acme-gateway',
  label: 'Acme Gateway',
  category: 'hosted',
  defaultBaseUrl: 'https://gateway.acme.example/v1',
  defaultModel: 'acme-chat',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_GATEWAY_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: true,
    },
  },
  usage: {
    supported: true,
    delegateToVendorId: 'acme',
  },
})
```

Explicit unsupported fallback:

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme-unsupported',
  label: 'Acme Unsupported',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme-unsupported.example/v1',
  defaultModel: 'acme-basic',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_UNSUPPORTED_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  usage: {
    supported: false,
  },
})
```

Current implementation rule:
`src/commands/usage/index.ts` currently resolves vendor and gateway targets,
plus the `firstParty` compatibility id. `src/components/Settings/Usage.tsx`
still has concrete UI branches for Anthropic, MiniMax, and Codex.

## Copy-paste safety checklist

Before promoting any sample from this file into a real descriptor:

- replace placeholder ids, labels, env vars, and URLs;
- confirm the descriptor type matches the external API contract;
- keep `transportConfig.kind` as the routing contract;
- keep `category` descriptive only;
- keep route-owned availability in the route catalog;
- set `openaiShim.supportsApiFormatSelection` and
  `openaiShim.supportsAuthHeaders` explicitly for OpenAI-compatible route
  templates;
- add `openaiShim.maxTokensField` when the provider is strict about
  `max_tokens` versus `max_completion_tokens`;
- keep `/usage` metadata honest about current runtime support;
- update compatibility or UI metadata only when the route should actually be
  user-facing.
