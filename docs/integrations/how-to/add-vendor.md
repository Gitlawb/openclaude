# How To Add a Vendor

## When to add a vendor

Add a vendor descriptor when the integration is the canonical API or
first-party model service for that provider.

Typical vendor cases:

- a direct OpenAI-compatible API with its own auth/base URL contract;
- a first-party model-serving endpoint that owns its own catalog;
- a vendor that should be selectable directly rather than only through a
  gateway.

Use a gateway descriptor instead when the route primarily hosts, proxies, or
aggregates models behind a separate endpoint contract.

## Step-by-step

1. Pick the descriptor file path.
   Use `src/integrations/vendors/<id>.ts`.
2. Choose the transport family.
   Common direct vendors use `transportConfig.kind: 'openai-compatible'`.
   Gemini-native and Anthropic-native routes keep their own transport kinds.
3. Define setup/auth metadata.
   Fill `setup.requiresAuth`, `setup.authMode`, and
   `setup.credentialEnvVars`.
4. Set the route defaults.
   Add `defaultBaseUrl`, `defaultModel`, and any required env vars or
   validation metadata.
5. Add a catalog if the vendor exposes models directly.
   Put the vendor's offered model subset on the vendor descriptor itself.
6. Add usage metadata if the vendor has real `/usage` support.
   If `/usage` is still unsupported, keep that explicit with
   `usage: { supported: false }`.
7. Only update compatibility/user-facing surfaces if this vendor should have a
   preset or legacy alias.

## Authoring rules

Normal vendor descriptor files should:

- use `defineVendor` and `defineCatalog`;
- default-export the descriptor;
- keep registration out of the file;
- avoid direct `registerVendor(...)` calls;
- avoid extra `import type` boilerplate in contributor-facing patterns unless a
  real type import is unavoidable.

Registration is loader-owned in `src/integrations/index.ts`.

## Example: standard API-key vendor with direct OpenAI-compatible routing

This is the common "direct hosted vendor" shape.

```ts
import { defineCatalog, defineVendor } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'acme-chat',
      apiName: 'acme-chat',
      label: 'Acme Chat',
      default: true,
    },
  ],
})

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
    setupPrompt: 'Paste your Acme API key.',
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  catalog,
  usage: {
    supported: false,
  },
})
```

Why this is the right shape:

- the route is first-party and direct, so it is a vendor, not a gateway;
- `transportConfig.kind` owns the transport choice;
- the vendor owns its own catalog because it exposes models directly;
- the file default-exports one typed descriptor and leaves registration to the
  loader.

## Example: vendor with custom static headers

Use static headers only for fixed protocol requirements. Secrets still belong
in credential env vars or runtime auth handling.

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme-labs',
  label: 'Acme Labs',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://labs.acme.example/v1',
  defaultModel: 'acme-research',
  requiredEnvVars: ['ACME_LABS_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_LABS_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    headers: {
      'X-Acme-Client': 'openclaude',
      'X-Acme-Protocol': 'labs-v1',
    },
    openaiShim: {
      maxTokensField: 'max_completion_tokens',
    },
  },
  usage: {
    supported: false,
  },
})
```

Use this pattern when:

- the provider requires fixed non-secret headers on every request;
- the route still speaks an OpenAI-compatible body shape;
- the token-field contract needs to be explicit.

## Example: vendor that owns a first-party model catalog

This is the OpenAI/DeepSeek-style pattern where the vendor serves multiple
first-party models directly.

```ts
import { defineCatalog, defineVendor } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'acme-fast',
      apiName: 'acme-fast',
      label: 'Acme Fast',
      default: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
    {
      id: 'acme-reasoner',
      apiName: 'acme-reasoner',
      label: 'Acme Reasoner',
      recommended: true,
      capabilities: {
        supportsReasoning: true,
      },
      contextWindow: 256_000,
      maxOutputTokens: 16_384,
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
  },
  catalog,
  usage: {
    supported: false,
  },
})
```

Use this when the vendor really is the route that serves the models. Do not
move route availability into the shared model index by default.

## Presets, compatibility mappings, and consumer surfaces

Most metadata-driven consumers now read descriptor state automatically, so you
should not need the old scattered switch edits for a normal vendor addition.

Only touch compatibility/user-facing surfaces when the new vendor should appear
as an explicit preset or legacy route alias.

Typical follow-up surfaces:

- `src/integrations/compatibility.ts`
  Add preset-to-route mapping only if you need a legacy/user-facing preset id.
- `src/integrations/providerUiMetadata.ts`
  Add UI ordering/summary metadata when the route should appear in provider
  selection flows.
- saved-profile or preset-default logic
  Only if the route needs an explicit onboarding/default profile path rather
  than simply existing in the registry.

If the route is only an internal descriptor or a route referenced by another
surface, those follow-up edits may not be necessary.

## What not to do

Avoid these patterns in new vendor docs and examples:

- `registerVendor(...)` inside the descriptor file;
- direct registry mutation from contributor-authored descriptor files;
- inventing extra runtime routing fields when `transportConfig.kind` already
  expresses the transport family;
- pushing route-owned model availability into shared model files by default;
- treating the legacy word "provider" as precise when you really mean vendor,
  gateway, route, or model.

## Verification checklist

Before calling the vendor guide complete:

- the file lives under `src/integrations/vendors/`;
- the descriptor default-exports a `defineVendor(...)` result;
- any direct model-serving route owns the subset of models it actually exposes;
- the transport family is expressed through `transportConfig.kind`;
- auth/setup metadata and validation routing are explicit;
- compatibility/preset surfaces were only updated if the route is meant to be
  user-facing.
