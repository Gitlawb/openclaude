# How To Add `/usage` Support

## What `/usage` resolves today

The descriptor-era `/usage` flow is centered on `getUsageDescriptor()` in
`src/commands/usage/index.ts`.

That resolver:

1. finds the active vendor or gateway descriptor;
2. reads the descriptor's `usage` metadata;
3. follows `delegateToVendorId` / `delegateToGatewayId` if present;
4. returns the final resolved usage target plus a `supported` flag.

Current implementation note:

- descriptor metadata already owns the support/delegation decision;
- the current resolver is still vendor/gateway-focused, with the `firstParty`
  compatibility id mapped to the `anthropic` vendor;
- `src/components/Settings/Usage.tsx` still has concrete UI branches for the
  currently supported runtime paths (`Anthropic`, `MiniMax`, and the separate
  `Codex` path);
- the descriptor schema already includes `fetchModule` and `parseModule`, but
  those fields are still a contract for supported integrations rather than a
  fully generic module-loader pipeline in this branch.

That means new docs should describe both the descriptor contract and the
current runtime reality.

## The `usage` field

The descriptor schema exposes these usage fields:

```ts
usage?: {
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
```

The same `UsageMetadata` shape can be attached to:

- `VendorDescriptor`
- `GatewayDescriptor`
- `AnthropicProxyDescriptor`

What each field means:

- `supported`
  Whether the route has real `/usage` support.
- `delegateToVendorId`
  Use the linked vendor's usage behavior instead of defining separate gateway
  behavior.
- `delegateToGatewayId`
  Use another gateway's usage behavior.
- `fetchModule`
  The module that should fetch raw usage data when a module-backed runtime is
  added or expanded.
- `parseModule`
  The module that should normalize raw usage data into the UI/runtime shape.
- `ui`
  Presentation hints for the usage UI.
- `silentlyIgnore`
  Reserved for cases where unsupported usage should avoid noisy user-facing
  errors.

## Anthropic proxy note

Anthropic proxy descriptors can declare the same `usage` field as vendors and
gateways.

Authoring rule:

- use the same explicit `supported`, delegation, fallback, and `ui` rules you
  would use on any other descriptor;
- do not assume usage support is inherited automatically just because the proxy
  speaks an Anthropic-compatible transport;
- keep unsupported proxies explicit with `usage: { supported: false }` until a
  real usage path exists.

Current runtime note:

- the descriptor schema supports this metadata today;
- the active `/usage` resolver in `src/commands/usage/index.ts` currently
  resolves vendor and gateway targets, plus the `firstParty` compatibility id;
- document anthropic-proxy usage metadata as part of the descriptor contract,
  but do not describe it as a separately routed `/usage` surface in this
  branch unless that resolver is expanded.

## When `/usage` belongs on the vendor descriptor

Put usage support on the vendor descriptor when:

- the vendor is the canonical owner of the usage API;
- direct vendor sessions should resolve to that usage behavior;
- gateways serving the same upstream should generally inherit the vendor's
  usage behavior rather than redefining it.

This is the normal pattern for first-party or direct vendors.

Current real examples in this branch:

- `anthropic`
- `minimax`

## When a gateway should delegate usage to a linked vendor

Use gateway delegation when:

- the gateway does not have its own separate usage API;
- the correct usage information comes from the underlying vendor;
- the route should resolve to the vendor's usage label/behavior after
  delegation.

In descriptor terms:

```ts
usage: {
  supported: true,
  delegateToVendorId: 'anthropic',
}
```

This lets the gateway stay explicit about support while avoiding duplicated
vendor usage logic.

## When a gateway should define its own usage handling

Give a gateway its own usage handling when:

- the gateway exposes its own usage/quota API;
- the numbers are not equivalent to the underlying vendor's usage view;
- UI text or refresh behavior must follow the gateway's own limits.

In that case the gateway keeps its own `usage` block instead of delegating:

```ts
usage: {
  supported: true,
  fetchModule: './usage/fetchGatewayUsage.js',
  parseModule: './usage/parseGatewayUsage.js',
  ui: {
    compactProgressBar: true,
    showResetCountdown: true,
  },
}
```

Current implementation note:

- the branch already understands `supported` and delegation through
  `getUsageDescriptor()`;
- if you add a truly new gateway-owned usage API, you will also need the
  runtime/UI follow-through in the usage settings surface until a more generic
  module-backed pipeline is introduced.

## Required fetch/parse module structure

The descriptor contract already reserves `fetchModule` and `parseModule` for
module-backed usage integrations.

Recommended structure:

`fetchModule`

- performs the network call or SDK call;
- handles auth and endpoint specifics for that provider/gateway;
- returns raw usage payloads without UI-specific formatting.

`parseModule`

- receives the raw usage payload;
- normalizes it into the shape the usage UI expects;
- keeps provider-specific quirks out of the higher-level usage resolver;
- should be deterministic and easy to test with fixtures.

Recommended file layout:

```text
src/
  services/
    api/
      usage/
        fetchAcmeUsage.ts
        parseAcmeUsage.ts
```

Recommended contract split:

- keep transport/auth/API calling in the fetch module;
- keep response-shape normalization in the parse module;
- keep descriptor wiring in the descriptor's `usage` field;
- keep route selection in `getUsageDescriptor()`.

## Worked example: vendor with native usage API

This is the simplest supported vendor pattern.

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
  },
  usage: {
    supported: true,
    fetchModule: './usage/fetchAcmeUsage.js',
    parseModule: './usage/parseAcmeUsage.js',
    ui: {
      showResetCountdown: true,
    },
  },
})
```

Use this pattern when the vendor really owns the usage endpoint and the route
should be the final resolved usage target.

## Worked example: gateway delegating usage to a linked vendor

Use this when the gateway should appear supported, but the actual usage source
of truth is the linked vendor.

```ts
import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'acme-gateway',
  label: 'Acme Gateway',
  category: 'hosted',
  defaultBaseUrl: 'https://gateway.acme.example/v1',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_GATEWAY_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  usage: {
    supported: true,
    delegateToVendorId: 'acme',
  },
})
```

This keeps the gateway descriptor honest while preventing duplicated usage
fetch/parse logic.

## Worked example: gateway with its own usage API

Use this when the gateway's quota or billing view is independent from the
linked model vendors.

```ts
import { defineGateway } from '../define.js'

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
  transportConfig: {
    kind: 'openai-compatible',
  },
  usage: {
    supported: true,
    fetchModule: './usage/fetchGalaxyUsage.js',
    parseModule: './usage/parseGalaxyUsage.js',
    ui: {
      compactProgressBar: true,
      showResetCountdown: true,
    },
  },
})
```

This is the right shape for a gateway whose own account limits matter more than
the upstream vendor's usage accounting.

## Worked example: unsupported-provider fallback

Be explicit when usage is unsupported.

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
  },
  usage: {
    supported: false,
    ui: {
      fallbackMessage: '/usage is not available for this provider.',
    },
  },
})
```

The important part is that unsupported routes stay explicit and resolve to a
neutral fallback rather than silently disappearing.

## Fallback behavior for unsupported providers

When usage is unsupported:

- keep `usage.supported` false;
- let the resolver return an unsupported descriptor;
- let the UI render the unsupported-provider fallback;
- do not fake vendor support just to avoid the fallback state.

The current settings usage screen already resolves unsupported providers to
`UnsupportedUsage` with the active provider label.

## Current supported routes in this branch

As of this branch state:

- `anthropic` is supported;
- `minimax` is supported;
- most other vendor and gateway descriptors are explicitly unsupported;
- `codex` still uses its own direct UI path outside the descriptor-backed
  vendor/gateway resolver.

That split is important when you update docs or runtime behavior.

## What not to do

Avoid these patterns:

- adding gateway-specific usage logic when the vendor should be the source of
  truth;
- using delegation when the gateway actually has its own distinct usage API;
- hiding unsupported usage by omitting the `usage` field when the route should
  explicitly report unsupported behavior;
- calling registry mutation helpers directly in usage examples;
- treating `fetchModule` / `parseModule` as already fully generic runtime hooks
  without also checking the current settings/runtime integration path.

## Verification checklist

Before calling a `/usage` guide complete:

- the doc lives under `/docs` as Markdown;
- it documents the `usage` field for vendors, gateways, and anthropic proxies;
- it distinguishes vendor-owned, delegated, and gateway-owned usage behavior;
- it explains the current unsupported fallback behavior;
- it includes vendor, gateway, and unsupported worked examples;
- examples use `define*` helpers and default exports rather than direct
  registry calls;
- the guide accurately notes the current implementation boundary between
  descriptor metadata and the still-concrete runtime/UI usage handlers.
