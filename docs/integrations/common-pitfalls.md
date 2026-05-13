# Common Pitfalls

## Purpose

This is the short pre-PR checklist for descriptor-era integration work.

Use it after reading the architecture note, the relevant how-to guide, and the
reference samples.

## Pitfall 1: Using the wrong descriptor type

Common mistake:
Modeling a route as a gateway or vendor just because it feels close enough.

Safer rule:

- use `VendorDescriptor` when the route is the canonical direct vendor API;
- use `GatewayDescriptor` when the route hosts, proxies, or aggregates models
  behind its own endpoint contract;
- use `AnthropicProxyDescriptor` when the route accepts Anthropic-native
  traffic through its own Anthropic-style env contract;
- use `ModelDescriptor` for shared model metadata, not route availability.

## Pitfall 2: Treating `category` as the routing contract

Common mistake:
Using gateway `category` to decide runtime behavior.

Safer rule:
`transportConfig.kind` is the routing contract. `category` is only optional
grouping/display metadata.

## Pitfall 3: Reintroducing removed gateway fields

Common mistake:
Adding fields such as `targetVendorId`, `isOpenAICompatible`, or routing-style
gateway `classification`.

Safer rule:
Keep routing in `transportConfig.kind`. Use current descriptor fields from
`src/integrations/descriptors.ts`, not legacy examples from older branches or
notes.

## Pitfall 4: Calling registry mutation helpers from descriptor files

Common mistake:
Using `registerGateway(...)`, `registerVendor(...)`, or `registerModel(...)`
inside contributor-authored descriptor files.

Safer rule:
Use the `define*` helpers from `src/integrations/define.ts` and default-export
the descriptor. Loader-owned registration stays in `src/integrations/index.ts`.

## Pitfall 5: Putting route availability into shared model files

Common mistake:
Treating `src/integrations/models/*.ts` as the main place to say where a model
is available.

Safer rule:
Shared model descriptors answer what a model is. Route-owned catalogs answer
where it is offered.

## Pitfall 6: Duplicating model defaults in catalog entries

Common mistake:
Marking catalog entries with per-model `default` or `recommended` flags after
the route already declares `defaultModel`.

Safer rule:
Declare the route's default once with `defaultModel`. UI recommendation labels
derive from that route default.

## Pitfall 7: Forgetting `providerModelMap` boundaries

Common mistake:
Assuming `providerModelMap` enables a route automatically.

Safer rule:
Use `providerModelMap` only to record route-specific API names for the same
conceptual model. The route catalog still decides whether that route exposes
the model.

## Pitfall 8: Omitting `openaiShim.maxTokensField` on strict routes

Common mistake:
Assuming every OpenAI-compatible route accepts the same max-token field.

Safer rule:

- use `max_completion_tokens` for newer hosted OpenAI-style contracts;
- use `max_tokens` for local or legacy-shaped routes and other providers that
  reject the newer field;
- keep the choice explicit in `transportConfig.openaiShim.maxTokensField` when
  the route is strict.

## Pitfall 9: Flattening real protocol differences

Common mistake:
Treating Bedrock, Vertex, Gemini, GitHub native Claude mode, or Mistral as if
they were all just generic OpenAI-compatible routes.

Safer rule:
If the external API contract is genuinely different, keep that difference
explicit. Descriptor-first does not mean protocol differences should be hidden.

## Pitfall 10: Overstating `/usage` support

Common mistake:
Declaring usage support because the descriptor schema allows it, without
checking the active runtime/UI path.

Safer rule:

- use `usage.supported: true` only when the route has real current support;
- delegate from a gateway to a vendor only when the vendor is the true source
  of usage data;
- keep unsupported routes explicit with `usage: { supported: false }`;
- remember that the current resolver in `src/commands/usage/index.ts` is still
  vendor/gateway-focused, with the current settings UI still concrete for
  Anthropic, MiniMax, and Codex.

## Pitfall 11: Hiding discovery complexity in the descriptor file

Common mistake:
Packing a large hybrid catalog or complex discovery rules inline in
`gateways/<id>.ts`.

Safer rule:
Move large catalog or discovery-specific logic into a companion
`gateways/<id>.models.ts` file and keep the descriptor file small.

## Pitfall 12: Rebuilding the old OpenAI context table

Common mistake:
Adding built-in context or output limits to
`src/utils/model/openaiContextWindows.ts`.

Safer rule:
Put built-in model metadata in `src/integrations/models/`. Keep
`openaiContextWindows.ts` focused on documented env overrides such as
`CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS` and
`CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS`.

## Pitfall 13: Forgetting the compatibility layer

Common mistake:
Changing descriptor metadata and assuming every public surface is already
descriptor-native.

Safer rule:
If the route should be user-facing in preset flows, add descriptor `preset`
metadata and regenerate the artifacts:

- `bun run integrations:generate`
- `src/integrations/generated/integrationArtifacts.generated.ts`
- env-facing flows that still preserve legacy names

Do not hand-edit:

- `src/integrations/compatibility.ts`
- `src/integrations/profileResolver.ts`
- `src/integrations/providerUiMetadata.ts`
- preset typing or preset ordering tables

Only touch remaining env-facing compatibility surfaces when the route truly
needs them.

## Pitfall 14: Using stale repo paths in docs

Common mistake:
Pointing contributors at outdated files or command entrypoints.

Safer rule:
Use the current repo surfaces:

- `src/commands/usage/index.ts` for descriptor-backed `/usage` routing
- `src/components/Settings/Usage.tsx` for the current usage UI boundary
- `src/integrations/routeMetadata.ts` for route/default/label helpers
- `src/integrations/runtimeMetadata.ts` for request-shaping metadata
- `src/integrations/discoveryCache.ts` and `src/integrations/discoveryService.ts`
  for discovery caching and loading

## Final check

Before opening or landing integration docs or descriptor changes:

- confirm the descriptor type is correct;
- confirm `transportConfig.kind` is doing the routing work;
- confirm examples use `define*` helpers plus default exports;
- confirm route catalogs own availability;
- confirm route defaults are declared once through `defaultModel`;
- confirm built-in model limits live in `src/integrations/models/`;
- confirm strict OpenAI-compatible routes specify the correct max-token field;
- confirm `/usage` docs match the actual current resolver/UI behavior;
- confirm any illustrative sample is clearly marked as illustrative.
