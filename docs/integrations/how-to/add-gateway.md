# How To Add a Gateway

## When to add a gateway

Add a gateway descriptor when the route hosts, proxies, or aggregates models
behind its own endpoint contract.

Typical gateway cases:

- a hosted OpenAI-compatible route with its own base URL and auth;
- a local route such as Ollama or LM Studio;
- an aggregating route that mixes third-party brands/models;
- a route that needs discovery metadata, discovery caching, or readiness
  probing.

## Step-by-step

1. Choose the file layout.
   Use `src/integrations/gateways/<id>.ts` for the descriptor. Add
   `src/integrations/gateways/<id>.models.ts` only when the catalog/discovery
   details are large enough to deserve a companion file.
2. Pick the transport family.
   `transportConfig.kind` is the routing contract.
3. Pick a `category`.
   `category` is optional grouping/display metadata only. It must not drive
   runtime routing.
4. Define setup and startup metadata.
   Gateways often need readiness or auto-detection hints in `startup`.
5. Choose the catalog strategy.
   Use `static`, `dynamic`, or `hybrid`.
6. Decide whether the gateway needs discovery cache TTL, refresh mode, and
   manual refresh.
7. Add any required static headers and decide whether users may add custom
   headers.
8. Only update compatibility/user-facing surfaces if the gateway should be
   selectable via a preset or legacy alias.

## Authoring rules

Normal gateway examples should:

- use `defineGateway` and `defineCatalog`;
- default-export the gateway descriptor;
- default-export the catalog from any companion `*.models.ts` file;
- avoid `registerGateway(...)` in contributor-authored examples;
- avoid removed legacy fields such as `targetVendorId`,
  `isOpenAICompatible`, or routing-oriented gateway `classification`.

The routing decision belongs to `transportConfig.kind`, not to `category`.

## One-file example: hosted gateway with only first-party models

This is the simplest hosted OpenAI-compatible gateway pattern.

```ts
import { defineCatalog, defineGateway } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'acme-hosted-fast',
      apiName: 'acme-hosted-fast',
      label: 'Acme Hosted Fast',
      default: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
    {
      id: 'acme-hosted-pro',
      apiName: 'acme-hosted-pro',
      label: 'Acme Hosted Pro',
      capabilities: {
        supportsReasoning: true,
      },
      contextWindow: 256_000,
      maxOutputTokens: 16_384,
      notes: 'Practical input limit is lower than the full context window.',
    },
  ],
})

export default defineGateway({
  id: 'acme-hosted',
  label: 'Acme Hosted',
  category: 'hosted',
  defaultBaseUrl: 'https://gateway.acme.example/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_HOSTED_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    headers: {
      'X-Acme-Client': 'openclaude',
    },
    supportsUserCustomHeaders: true,
    openaiShim: {
      maxTokensField: 'max_completion_tokens',
    },
  },
  catalog,
  usage: {
    supported: false,
  },
})
```

What this example covers:

- one-file gateway onboarding;
- hosted OpenAI-compatible routing;
- required static custom headers;
- optional user-supplied custom headers;
- a static catalog;
- a gateway with only its own hosted models;
- different reasoning/context/input/output behavior across models.

## Transport family examples

### Hosted OpenAI-compatible gateway

Use `transportConfig.kind: 'openai-compatible'` when the route speaks an
OpenAI-compatible request/response contract.

```ts
transportConfig: {
  kind: 'openai-compatible',
}
```

### Local gateway

Use `transportConfig.kind: 'local'` for routes such as Ollama or LM Studio.

```ts
transportConfig: {
  kind: 'local',
  openaiShim: {
    maxTokensField: 'max_tokens',
  },
}
```

### Anthropic-proxy transport family

If you truly have a gateway-shaped route that accepts Anthropic-native traffic,
the routing contract still comes from `transportConfig.kind`.

```ts
transportConfig: {
  kind: 'anthropic-proxy',
}
```

In most cases, a real Anthropic-native third-party route should eventually be
documented through the dedicated anthropic-proxy guide in Phase 4C. The key
point here is that the transport family belongs in `transportConfig.kind`, not
in a gateway-specific compatibility flag.

## Local dynamic discovery example

This is the common local gateway shape.

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

What this example covers:

- `transportConfig.kind: 'local'`;
- `catalog.source: 'dynamic'`;
- a local readiness/discovery flow;
- `max_tokens` for a local/legacy-compatible token field;
- a `startup` refresh mode example.

## Two-file example: hybrid gateway with discovery cache

Use a companion `*.models.ts` file when the catalog or discovery rules are too
large to keep inline.

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
      default: true,
      modelDescriptorId: 'gpt-5-mini',
    },
    {
      id: 'galaxy-curated-reasoner',
      apiName: 'galaxy/deepseek-r1',
      label: 'DeepSeek R1 (via Galaxy)',
      recommended: true,
      modelDescriptorId: 'deepseek-reasoner',
      capabilities: {
        supportsReasoning: true,
      },
      contextWindow: 256_000,
      maxOutputTokens: 32_768,
      notes: 'Practical input limit is 192k tokens on this route.',
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
      maxTokensField: 'max_completion_tokens',
    },
  },
  catalog,
  usage: {
    supported: false,
  },
})
```

What this example covers:

- a two-file gateway pattern;
- `catalog.source: 'hybrid'`;
- human-readable discovery cache TTL;
- `background-if-stale` refresh;
- manual refresh enabled;
- stale cache fallback by design through the shared discovery cache service;
- a mixed catalog of hosted third-party models;
- different reasoning/context/input/output behavior across entries.

Because `allowManualRefresh` is enabled, this is the right pattern for routes
that should support `/model refresh` and in-picker refresh. The shared
discovery cache keeps curated entries visible while refreshes fail or become
stale.

## `providerModelMap` in mixed gateway catalogs

If the gateway exposes a shared model under a route-specific API name, point
the gateway catalog entry at a shared model descriptor and use that model
descriptor's `providerModelMap` to record route-specific names.

Minimal pattern:

```ts
import { defineModel } from '../define.js'

export default defineModel({
  id: 'deepseek-reasoner',
  label: 'DeepSeek Reasoner',
  vendorId: 'deepseek',
  classification: ['chat', 'reasoning'],
  defaultModel: 'deepseek-reasoner',
  providerModelMap: {
    galaxy: 'galaxy/deepseek-r1',
    openrouter: 'deepseek/deepseek-r1',
  },
  capabilities: {
    supportsReasoning: true,
  },
})
```

The gateway still owns route availability. `providerModelMap` only helps shared
model metadata stay reusable across multiple routes.

## Static vs dynamic vs hybrid

Use:

- `static`
  when discovery is unavailable or unnecessary;
- `dynamic`
  when the route should rely entirely on runtime discovery;
- `hybrid`
  when you need curated entries plus discovered models.

Typical choices:

- `static`
  stable hosted routes with a small fixed catalog;
- `dynamic`
  local routes or provider catalogs that change frequently;
- `hybrid`
  aggregators where curated defaults should stay visible even while discovery
  fills in the rest.

## Discovery cache TTL examples

Use human-readable TTLs in `discoveryCacheTtl`:

- `30m`
  fast-changing catalogs where freshness matters;
- `1h`
  moderately active hosted routes;
- `1d`
  stable hosted or local routes where churn is low.

## Discovery refresh mode examples

Use `discoveryRefreshMode` to match the operational shape of the route:

- `manual`
  flaky or rate-limited providers where refresh should happen only on demand;
- `on-open`
  routes where the picker should always try for a fresh list;
- `background-if-stale`
  the normal hosted-gateway choice when cached models should appear immediately;
- `startup`
  fast local routes where startup probing is cheap and useful.

## `max_tokens` vs `max_completion_tokens`

OpenAI-compatible APIs do not all accept the same max-token field.

Use `openaiShim.maxTokensField: 'max_tokens'` when:

- the route is local or legacy-shaped;
- the provider rejects `max_completion_tokens`;
- the provider is Z.AI-style or otherwise strict about the older field;
- the route matches Moonshot/DeepSeek/local compatibility behavior.

Use `openaiShim.maxTokensField: 'max_completion_tokens'` when:

- the route expects the newer OpenAI/Azure-style contract;
- the provider rejects `max_tokens`;
- you want the route to stay aligned with newer hosted OpenAI-compatible APIs.

Strict-route example:

```ts
transportConfig: {
  kind: 'openai-compatible',
  openaiShim: {
    maxTokensField: 'max_tokens',
  },
}
```

Hosted modern-route example:

```ts
transportConfig: {
  kind: 'openai-compatible',
  openaiShim: {
    maxTokensField: 'max_completion_tokens',
  },
}
```

## Custom headers

Required static headers belong in `transportConfig.headers`.

Optional user-supplied custom headers should be allowed only when the route
really supports them:

```ts
transportConfig: {
  kind: 'openai-compatible',
  headers: {
    'X-Acme-Client': 'openclaude',
  },
  supportsUserCustomHeaders: true,
}
```

Do not use custom headers as a substitute for transport-family selection.

## Presets, compatibility mappings, and consumer surfaces

Most runtime/UI surfaces now consume descriptor-backed metadata, so normal
gateway additions should not require broad switch editing.

Only update compatibility or user-facing consumer surfaces when the gateway is
supposed to appear as a preset or explicit selectable route.

Typical follow-up surfaces:

- `src/integrations/compatibility.ts`
  if the gateway needs a preset/legacy mapping;
- `src/integrations/providerUiMetadata.ts`
  if the route should appear in provider ordering/summary metadata;
- saved-profile/default-onboarding flows
  only when the gateway should be offered as a first-class user-facing preset.

## What not to do

Avoid these patterns:

- `registerGateway(...)` in the descriptor file;
- `targetVendorId`, `isOpenAICompatible`, or routing-oriented gateway
  `classification`;
- using `category` to make runtime routing decisions;
- placing large discovery/cached-catalog logic inline when a companion
  `*.models.ts` file would be clearer;
- treating every gateway as if it exposes every shared model.

## Verification checklist

Before calling the gateway guide complete:

- the descriptor lives under `src/integrations/gateways/`;
- one-file and two-file patterns are both covered where useful;
- the gateway declares only the model subset it actually offers;
- `transportConfig.kind` is the routing contract;
- `category` is treated as grouping/display metadata only;
- any discovery route includes the right cache TTL, refresh mode, and manual
  refresh behavior;
- custom headers and token-field behavior are explicit where required;
- compatibility/preset surfaces were only updated when the route is meant to be
  user-facing.
