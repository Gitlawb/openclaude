# Integrations Overview

## Purpose

This folder is the contributor-facing documentation set for the descriptor-era
integration system.

Use it for:

- terminology and architecture rules;
- authoring rules for descriptor files;
- future how-to guides for vendors, gateways, models, anthropic proxies, and
  `/usage`;
- reference samples that match the current implementation.

## Documentation Structure

Phase 4 uses this docs layout:

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

Current Phase 4A outputs:

- `docs/architecture/integrations.md`
- `docs/integrations/overview.md`
- `docs/integrations/glossary.md`

Current Phase 4B outputs:

- `docs/integrations/how-to/add-vendor.md`
- `docs/integrations/how-to/add-gateway.md`

Planned later packets:

- `docs/integrations/how-to/add-model.md`
- `docs/integrations/how-to/add-anthropic-proxy.md`
- `docs/integrations/how-to/add-usage-support.md`
- `docs/integrations/reference-samples.md`
- `docs/integrations/common-pitfalls.md`

## Reading Order

If you are onboarding to the integration system:

1. Read `docs/architecture/integrations.md` for the system boundaries.
2. Read `docs/integrations/glossary.md` for the shared vocabulary.
3. Use the how-to guides for the specific descriptor type you are adding.
4. Use the reference samples only after the architecture and glossary are clear.

## Core Rules

### Metadata vs routing vs transport

Keep these concerns separate:

- metadata
  Descriptor files declare labels, defaults, catalogs, setup requirements,
  validation hints, and request-shaping metadata.
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

## Descriptor Authoring Pattern

Normal descriptor files should:

- use the `define*` helpers from `src/integrations/define.ts`;
- default-export the descriptor object or model list;
- keep registration out of the descriptor file;
- keep route-owned catalogs with the route unless shared model metadata is
  genuinely useful.

Typical helper usage:

- `defineVendor`
- `defineGateway`
- `defineCatalog`
- `defineModel`
- `defineBrand`
- `defineAnthropicProxy`

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
loader concern, not a descriptor-file concern.

## Compatibility Layer

The descriptor system is the source of truth, but a compatibility layer still
exists for older env/config/public-callers.

Important compatibility surfaces include:

- `src/integrations/compatibility.ts`
  legacy preset name to descriptor-route mapping;
- `src/integrations/profileResolver.ts`
  stored provider/profile id resolution;
- `src/utils/model/providers.ts`
  `APIProvider` / `LegacyAPIProvider`;
- `src/utils/providerFlag.ts`
  env-facing `--provider` behavior.

Contributor docs should describe these as compatibility bridges, not as the
primary architecture.
