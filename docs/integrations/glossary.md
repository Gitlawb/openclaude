# Integrations Glossary

## Brand

A shared model-family identity such as Claude, GPT, Kimi, DeepSeek, Llama, or
Qwen. Brands provide reusable family-level metadata and help related model
descriptors stay organized.

## Catalog

The route-owned list of models that a vendor route or gateway route actually
offers. Catalog entries should name the route-facing API model and may point at
shared model metadata with `modelDescriptorId`. A catalog can be:

- `static`
- `dynamic`
- `hybrid`

Catalog ownership lives with the route, not with the global model index. Route
defaults live on the descriptor's `defaultModel`, not as per-entry default or
recommended flags.

## Category

Optional gateway display/grouping metadata:

- `local`
- `hosted`
- `aggregating`

Category is descriptive only. It must not drive runtime routing.

## Compatibility Layer

The set of env/preset/legacy-name bridges that keep older user config and older
callers working while the repo transitions to descriptor-backed metadata.

Examples include:

- `src/integrations/compatibility.ts`
- `src/integrations/profileResolver.ts`
- `src/utils/model/providers.ts`
- `src/utils/providerFlag.ts`

## Descriptor

A typed metadata object defined under `src/integrations/` through one of the
`define*` helpers. Descriptors describe integrations; they are not runtime
executors.

## Direct Vendor Route

A vendor that also acts as its own model-serving route, rather than only
existing behind a separate gateway.

Current examples include first-party or direct vendors such as OpenAI,
DeepSeek, Gemini, MiniMax, and Bankr.

## Gateway

A route that hosts, proxies, or aggregates models behind its own endpoint and
transport contract.

Examples:

- Ollama
- LM Studio
- OpenRouter
- Together
- Groq

## Loader-Owned Registration

The rule that descriptor files define typed data, while
`src/integrations/index.ts` is responsible for loading and registering that
data into the registry through generated descriptor artifacts. Normal
descriptor files should not call registry mutation helpers directly.

## Metadata

The descriptive information about an integration, such as:

- label
- defaults
- setup/auth hints
- validation selection
- discovery policy
- catalog entries
- request-shaping flags

Metadata answers what a route is and what it supports.

## Model Descriptor

A shared model metadata record under `src/integrations/models/`. Model
descriptors own reusable model identity, family metadata, capabilities, context
windows, output limits, cache behavior, and route-specific API aliases through
`providerModelMap`.

Model descriptors do not declare route availability by themselves. Routes still
declare their offered subset in their catalogs.

## Provider

Legacy umbrella term that historically mixed multiple concerns together.

Contributor docs should prefer more precise terms when possible:

- vendor
- gateway
- model
- brand
- anthropic proxy
- route

## Route

The runtime-selectable integration surface that serves models.

In practice, a route may be:

- a gateway descriptor, or
- a direct vendor descriptor that exposes models itself.

Route-centric helpers resolve labels, defaults, transport kind, discovery, and
runtime metadata for the currently active integration.

## Routing

The logic that maps presets, profile ids, env state, or base URLs onto the
active route and transport family.

Routing is not the same as metadata and not the same as transport execution.

## Transport

The request-execution contract used to talk to an external API or local
runtime.

Examples:

- Anthropic-native
- Anthropic-proxy
- OpenAI-compatible
- local
- Gemini-native
- Bedrock
- Vertex

Transport code executes requests. It should consume descriptor/runtime metadata
rather than redefining the integration matrix itself.

## `transportConfig.kind`

The routing contract field on a route descriptor. This is the authoritative
transport-family selector for gateways and other routes.

If runtime behavior differs because the underlying protocol differs,
`transportConfig.kind` is the first field to inspect.

## Vendor

The canonical API or first-party model service behind an integration.

Examples:

- Anthropic
- OpenAI
- Google/Gemini
- Moonshot
- DeepSeek
- MiniMax
- Bankr

Vendors own auth defaults, canonical base URLs, direct catalogs when
applicable, and vendor-specific metadata.

## Anthropic Proxy

A distinct descriptor type for third-party endpoints that accept Anthropic-
native requests through a non-Anthropic endpoint and auth/base-URL contract.

An anthropic proxy is not the same thing as an OpenAI-compatible gateway.
