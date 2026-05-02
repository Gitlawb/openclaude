# Integrations Architecture

## Purpose

OpenClaude's provider system is now descriptor-first:

- descriptors under `src/integrations/` define vendors, gateways, brands,
  shared model metadata, validation hints, discovery strategy, and supported
  transport capabilities;
- registry helpers load those descriptors and expose route/model lookups;
- runtime metadata bridges descriptor state into request execution without
  reintroducing broad hand-maintained provider switches.

This note captures the post-Phase-3 architecture plus the remaining
constraints and known exceptions that are still expected to exist.

Companion docs:

- `docs/integrations/overview.md`
  Contributor-facing map of the integration docs set and the authoring rules.
- `docs/integrations/glossary.md`
  Standard terminology for vendors, gateways, routes, models, brands, and
  anthropic proxies.

## Source of truth

The primary source of truth now lives in these layers:

1. `src/integrations/descriptors.ts`
   Defines the descriptor shapes.
2. `src/integrations/index.ts` and `registry.ts`
   Load and expose the registered vendors, gateways, brands, and models.
3. `src/integrations/routeMetadata.ts`
   Resolves route labels/defaults and maps active env state onto route ids.
4. `src/integrations/runtimeMetadata.ts`
   Derives request-time OpenAI-shim behavior from the active route plus the
   selected model/catalog entry.
5. Discovery, validation, and provider-profile helpers
   Consume descriptor metadata instead of owning their own provider lists.

In other words: descriptor metadata should decide which route exists and what
it supports; runtime code should execute that metadata, not replace it with a
parallel provider matrix.

## Metadata, routing, and transport

These concerns are related, but they are not interchangeable:

- metadata
  Descriptor files declare labels, defaults, catalogs, validation hints,
  discovery policy, and capability flags.
- routing
  Route-resolution helpers decide which descriptor is active and which runtime
  path should receive the request.
- transport
  Runtime code such as native Anthropic handlers, Gemini handling, and
  `openaiShim.ts` performs the actual request shaping and execution.

The rule of thumb is:

- descriptors own what a route is and what it says it supports;
- routing helpers own how current config/env state maps onto that route;
- transport code owns how requests are executed for the active route.

If a future change needs a new label, default model, setup hint, discovery
policy, or request-shaping flag, it probably belongs in descriptor/runtime
metadata. If it changes the actual HTTP/API contract, it probably belongs in
transport code.

## Gateway routing contract

For gateway descriptors, `transportConfig.kind` is the routing contract.

- use `transportConfig.kind` to decide whether a route is local,
  OpenAI-compatible, Anthropic-proxy, Bedrock, Vertex, or another supported
  transport family;
- do not use gateway `category` to choose runtime routing behavior.

Gateway `category` is optional display/grouping metadata only:

- `local` helps group routes like Ollama or LM Studio in UI/docs;
- `hosted` helps describe remote first-party or managed endpoints;
- `aggregating` helps describe routes that expose mixed third-party catalogs.

That category is useful for contributor understanding, but runtime selection
must continue to key off `transportConfig.kind`.

## Descriptor authoring pattern

Normal descriptor files should follow the `define*` + default-export pattern:

```ts
import { defineGateway, defineCatalog } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'acme-fast',
      apiName: 'acme/fast',
      modelDescriptorId: 'acme-fast',
    },
  ],
})

export default defineGateway({
  id: 'acme',
  label: 'Acme AI',
  category: 'hosted',
  defaultBaseUrl: 'https://api.acme.example/v1',
  defaultModel: 'acme/fast',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: true,
    },
  },
  catalog,
})
```

Contributors should not call `registerGateway`, `registerVendor`,
`registerModel`, or other registry functions directly from normal descriptor
files. Registration is loader-owned:

- the descriptor file defines typed data;
- `bun run integrations:generate` derives
  `src/integrations/generated/integrationArtifacts.generated.ts`;
- `src/integrations/index.ts` loads and registers that generated descriptor
  inventory;
- registry helpers expose the loaded data to the rest of the app.

That keeps onboarding additive and prevents descriptor files from turning back
into distributed registration logic.

## Compatibility layer

The repo still has a few intentionally named compatibility bridges because the
public env/config contract is not descriptor-native yet:

- `src/integrations/compatibility.ts`
  is a thin derived view over the generated preset manifest and maps legacy
  provider preset names onto descriptor-backed route ids;
- `src/integrations/profileResolver.ts`
  keeps stored/sanitized provider ids compatible with descriptor routes;
- `src/utils/model/providers.ts`
  preserves `APIProvider` / `LegacyAPIProvider` for older callers;
- `src/utils/providerFlag.ts`
  still writes the env-facing provider contract even though it now reads shared
  descriptor metadata.

When contributor docs say "compatibility layer," they mean these env/preset/
legacy-name bridges rather than the descriptor registry itself.

Preset ordering for `/provider` flows is also derived. The generated manifest
pins `anthropic` first, sorts the remaining preset-participating routes by
preset description using standard alphanumeric sorting, and always keeps
`custom` at the bottom automatically.

## Current constraints

The architecture is descriptor-first, but not descriptor-only yet. A few
compatibility surfaces still exist because public/runtime contracts are still
env-centric.

### Temporary compatibility bridges

These are expected to shrink in later work, but they are still correct today:

- `src/integrations/routeMetadata.ts`
  `resolveActiveRouteIdFromEnv()` still honors `CLAUDE_CODE_USE_*` flags and
  OpenAI-compatible env fallback because bootstrap and saved-profile flows are
  still env-driven.
- `src/utils/providerFlag.ts`
  `--provider` still writes the legacy env contract directly, even though it
  now reads descriptor defaults where possible.
- `src/utils/model/providers.ts`
  `LegacyAPIProvider`/`APIProvider` remain as the compatibility surface for
  older callers, including env-only MiniMax and NVIDIA NIM recovery.
- `src/commands/provider/provider.tsx`
  Current/saved-provider summaries still read provider-specific env/profile
  fields directly.
- `src/components/StartupScreen.ts`
  Startup banner labels are still derived from active env state and heuristics.

These bridges are not evidence that the descriptor migration failed; they are
evidence that the public env/config contract has not been redesigned yet.

### Intentional long-term runtime exceptions

Some provider-specific behavior is real protocol or capability divergence and
should remain explicit unless the external API changes.

- GitHub is a dual-mode route.
  Claude models can use Anthropic-native message format, while Copilot/Models
  traffic still uses OpenAI/Codex-style transport behavior.
- Mistral is not just "generic OpenAI-compatible".
  It still requires dedicated env selection and request shaping.
- Azure OpenAI and Bankr have distinct auth/header contracts.
  Azure uses `api-key` and deployment URLs; Bankr uses `X-API-Key`.
- Gemini still has provider-specific credential handling and thought-signature
  behavior at the shim boundary.
- DeepSeek and Moonshot/Kimi still need route-specific `reasoning_content`,
  `max_tokens`, and `store` shaping.
- Bedrock, Vertex, and Foundry stay on dedicated Anthropic-family SDK/auth
  flows rather than the generic OpenAI-compatible transport.
- Native web search is only valid on native Anthropic-family paths
  (`firstParty`, `vertex`, `foundry`) and the separate Codex path.
- MiniMax keeps dedicated `/usage` execution logic because its usage endpoints
  are not the same as the generic vendor path.
- Conversation recovery must preserve Anthropic-native thinking blocks for
  native transports while stripping them for OpenAI-compatible routes.

## Known exceptions

As of Phase 3 completion, the main known exception categories are:

- `github`
- `mistral`
- `bedrock`
- `vertex`
- `foundry`
- env-only MiniMax fallback
- env-only NVIDIA NIM fallback
- Bankr auth/header aliasing
- Azure deployment/auth request shaping
- MiniMax dedicated `/usage`
- native web-search gating
- Anthropic-native thinking preservation during conversation recovery

These are not all the same kind of exception:

- some are long-term protocol differences;
- some are temporary env/config bridges;
- some are hybrid compatibility shims at the transport boundary.

Any future cleanup should preserve that distinction.

## What Phase 3 finished

Phase 3 removed stale metadata/naming/env duplication, but it intentionally did
not force every provider down one synthetic execution path.

Completed in Phase 3:

- removed metadata-only dead switches;
- renamed compatibility surfaces so they read as compatibility bridges rather
  than descriptor-native routing;
- consolidated env shaping between startup/profile helpers and config-backed
  profile activation;
- moved eligible OpenAI-shim base URL/model selection under route/runtime
  metadata;
- recorded the remaining exceptions instead of leaving them implicit.

## Follow-on guidance

If a future change touches provider-specific runtime behavior:

- first decide whether the branch is a real external API contract difference or
  only a compatibility bridge;
- if it is a real contract difference, keep it explicit and document it;
- if it is a compatibility bridge, prefer moving the decision closer to
  descriptor/runtime metadata rather than cloning more env-specific logic;
- do not remove a documented exception just because it looks repetitive; remove
  it only when equivalent behavior is proven by tests.

For the detailed post-Phase-3 inventory, see
`plan/phase-3d-final-audit.md`.
