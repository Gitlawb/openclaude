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
7. If the vendor should appear in preset-driven `/provider` flows, add a
   `preset` block on the descriptor.
8. Run `bun run integrations:generate` so the generated loader and preset
   manifest stay in sync.

## Authoring rules

Normal vendor descriptor files should:

- use `defineVendor` and `defineCatalog`;
- default-export the descriptor;
- keep registration out of the file;
- avoid direct `registerVendor(...)` calls;
- avoid extra `import type` boilerplate in contributor-facing patterns unless a
  real type import is unavoidable.

Registration is loader-owned through the generated artifacts consumed by
`src/integrations/index.ts`.

## Generated loader and preset manifest

Normal vendor onboarding is additive now:

1. add or edit the descriptor file;
2. add a `preset` block only if the vendor should be user-facing in preset
   flows;
3. run `bun run integrations:generate`;
4. let `src/integrations/generated/integrationArtifacts.generated.ts` feed the
   loader, compatibility mapping, preset typing, and provider UI metadata.

Preset ordering is derived automatically: `anthropic` is pinned first, middle
entries sort by preset description using standard alphanumeric sorting, and
`custom` is pinned last by the generated manifest. This ordering is not
configurable from descriptor files.

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
  preset: {
    id: 'acme',
    description: 'Acme AI API',
    apiKeyEnvVars: ['ACME_API_KEY'],
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

For OpenAI-compatible vendors, put fixed request headers in
`transportConfig.openaiShim.headers`. Secrets still belong in credential env
vars or runtime auth handling.

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
    openaiShim: {
      headers: {
        'X-Acme-Client': 'openclaude',
        'X-Acme-Protocol': 'labs-v1',
      },
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

## Presets and user-facing vendor onboarding

Most metadata-driven consumers now read generated descriptor-backed state, so a
normal vendor addition should not require broad switch editing.

Only add `preset` metadata when the vendor should appear as an explicit preset
or legacy-facing selectable route.

```ts
preset: {
  id: 'acme',
  description: 'Acme AI API',
  apiKeyEnvVars: ['ACME_API_KEY'],
}
```

Then regenerate:

```bash
bun run integrations:generate
```

That keeps `src/integrations/index.ts`, `src/integrations/compatibility.ts`,
`src/integrations/providerUiMetadata.ts`, and the generated preset-id type in
sync without hand-editing them.

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
- user-facing preset participation is expressed through descriptor `preset`
  metadata and regenerated artifacts rather than handwritten follow-through.
