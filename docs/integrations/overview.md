# Integrations Overview

## Purpose

This folder is the contributor-facing documentation set for the descriptor-era
integration system.

Use it for:

- terminology and architecture rules;
- authoring rules for descriptor files;
- how-to guides for vendors, gateways, models, anthropic proxies, and
  `/usage`;
- reference samples that match the current implementation.

## Documentation Structure

This is the current docs layout:

```text
docs/
  architecture/
    integrations.md
  integrations/
    overview.md
    glossary.md
    how-to/
      add-vendor.md
      add-gateway.md
      add-model.md
      add-anthropic-proxy.md
      add-usage-support.md
    reference-samples.md
    common-pitfalls.md
```

All of the files listed above are part of the current contributor guide for the
descriptor-era integration system.

## Reading Order

If you are onboarding to the integration system:

1. Read `docs/architecture/integrations.md` for the system boundaries.
2. Read `docs/integrations/glossary.md` for the shared vocabulary.
3. Use the how-to guides for the specific descriptor type you are adding.
4. Use `docs/integrations/reference-samples.md` once the architecture and the relevant how-to guide are clear.
5. Read `docs/integrations/common-pitfalls.md` before opening a docs or implementation PR for a new integration.

## Core Rules

### Metadata vs routing vs transport

Keep these concerns separate:

- metadata
  Descriptor files declare route labels, setup requirements, validation hints,
  transport selection, and request-shaping metadata. Provider JSON catalogs
  declare model availability, defaults, limits, capabilities, pricing, aliases,
  and endpoint selection.
- routing
  Route/profile helpers map user config, presets, and env state onto the active
  descriptor route.
- transport
  Runtime execution code actually performs the request using the active
  transport family.

If a change is about what a route is, it likely belongs in descriptors. If it
is about how a request is executed against an external API contract, it likely
belongs in transport code.

### `transportConfig.kind` is the routing contract

For gateways, `transportConfig.kind` is the field that tells runtime code which
transport family the route belongs to.

Examples:

- `'openai-compatible'`
- `'local'`
- `'anthropic-proxy'`
- `'bedrock'`
- `'vertex'`

Do not use gateway `category` for routing decisions. `category` is optional
display/grouping metadata only.

### `category` is descriptive, not executable

Gateway `category` exists to help people understand the route:

- `local`
- `hosted`
- `aggregating`

It is valid to use `category` for docs, grouping, or display copy. It is not
valid to treat `category` as the transport selector.

### OpenAI-compatible request shaping belongs in `openaiShim`

For OpenAI-compatible or local routes, keep request-shaping metadata in
`transportConfig.openaiShim`.

Examples:

- `maxTokensField`
- `headers`
- `supportsApiFormatSelection`
- `supportsAuthHeaders`

That matches the current runtime metadata flow in
`src/integrations/runtimeMetadata.ts`.

`supportsApiFormatSelection` and `supportsAuthHeaders` also control the
advanced `/provider add` and `/provider edit` fields for OpenAI-compatible
routes. Fixed direct vendors usually set both to `false`; broad custom routes
or gateways that intentionally accept user-supplied auth/header details set the
relevant flag to `true`.

## Descriptor Authoring Pattern

Normal descriptor files should:

- use the `define*` helpers from `src/integrations/define.ts`;
- default-export the descriptor object or model list;
- keep registration out of the descriptor file;
- put provider model facts in
  `src/integrations/modelCatalog/providers/*.json`;
- use `src/integrations/models/` only for optional shared descriptor/glossary
  metadata that is genuinely useful across provider catalogs;
- keep env-override compatibility helpers free of built-in model tables.
- run `bun run integrations:generate` after adding brand-new provider JSON
  catalogs so the generated static import list is refreshed.

Typical helper usage:

- `defineVendor`
- `defineGateway`
- `defineModel`
- `defineBrand`
- `defineAnthropicProxy`

`defineCatalog` remains available for legacy/test fixtures, but normal
provider and gateway model lists should be authored in provider JSON catalogs
under `src/integrations/modelCatalog/providers/`.

Normal descriptor files should not:

- call `registerGateway`, `registerVendor`, `registerModel`, or similar
  registry functions directly;
- import registry mutation helpers just to make a descriptor visible;
- turn simple route additions into scattered consumer edits.

## Loader-Owned Registration

Registration is owned by `src/integrations/index.ts`.

That means the normal contributor workflow is:

1. create or edit the descriptor file;
2. keep the export typed through the appropriate `define*` helper;
3. let the loader own registration;
4. let registry consumers read the loaded descriptor state.

The loader may still be manually enumerated in some places today, but that is a
generated-artifact concern, not a descriptor-file concern.

Normal contributor flow for new preset-participating routes is:

1. add or edit the descriptor file;
2. add `preset` metadata only when the route should be user-facing;
3. run `bun run integrations:generate`;
4. let the generated manifest feed the loader, compatibility mapping, preset
   typing, and provider UI metadata.

## Compatibility Layer

Provider catalogs and descriptors feed the compatibility layer for older
env/config/public-callers. Provider model facts come from
`src/integrations/modelCatalog/providers/*.json`; descriptors still own
transport and shared route metadata.

Important compatibility surfaces include:

- `src/integrations/compatibility.ts`
  derived legacy preset name to descriptor-route mapping;
- `src/integrations/profileResolver.ts`
  stored provider/profile id resolution;
- `src/utils/model/providers.ts`
  `APIProvider` / `LegacyAPIProvider`;
- `src/utils/providerFlag.ts`
  env-facing `--provider` behavior.

Contributor docs should describe these as compatibility bridges, not as the
primary architecture.

Preset ordering pins `anthropic` first, derives the middle entries from preset
descriptions with standard alphanumeric sorting, and pins `custom` last
automatically.
