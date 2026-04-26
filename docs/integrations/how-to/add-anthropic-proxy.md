# How To Add an Anthropic Proxy

## What an anthropic proxy is

An anthropic proxy is a third-party route that accepts Anthropic-native
requests through a non-Anthropic endpoint and env contract.

It is a distinct descriptor type because the transport contract is different
from an OpenAI-compatible gateway:

- request/response shape stays Anthropic-native;
- auth and base URL env vars are Anthropic-proxy specific;
- routing should stay on the Anthropic-family transport path, not the generic
  OpenAI-compatible shim path.

Even if the repo has not started shipping concrete anthropic proxy descriptors
yet, this is the contract future contributors should follow.

## When to add an anthropic proxy

Add an anthropic proxy descriptor when:

- the upstream accepts Anthropic-native requests;
- the route is not simply another OpenAI-compatible endpoint;
- the route needs Anthropic-style auth/base URL handling through its own env
  variable contract.

Do not use an anthropic proxy descriptor when the route is actually
OpenAI-compatible. In that case, use a gateway or direct-vendor descriptor with
the appropriate `transportConfig.kind`.

## Step-by-step

1. Create the descriptor file under `src/integrations/anthropicProxies/`.
2. Use `defineAnthropicProxy(...)`.
3. Set the proxy identity fields.
   Include `id`, `label`, `classification: 'anthropic-proxy'`,
   `defaultBaseUrl`, and `defaultModel`.
4. Fill the setup metadata.
   Add `setup.requiresAuth`, `setup.authMode`, and
   `setup.credentialEnvVars`.
5. Fill `envVarConfig`.
   This is the Anthropic-proxy-specific env contract.
6. Set `transportConfig.kind: 'anthropic-proxy'`.
7. Add capabilities and optional catalog/usage/validation metadata as needed.
8. Let loader-owned registration handle the descriptor once the repo begins
   loading concrete anthropic proxy files.

## Authoring rules

Anthropic proxy examples should:

- use `defineAnthropicProxy`;
- default-export the descriptor;
- keep registration out of the file;
- make the proxy env contract explicit through `envVarConfig`;
- keep the route on Anthropic-family transport behavior.

Do not treat an anthropic proxy as "just another gateway with a different
header." The transport contract is different.

## Anthropic-specific env var contract

`envVarConfig` tells the rest of the system which env vars control the proxy's
auth and routing.

The descriptor contract is:

```ts
envVarConfig: {
  authTokenEnvVar: string
  baseUrlEnvVar: string
  modelEnvVar?: string
}
```

That means the proxy should explicitly declare:

- which env var contains the auth token;
- which env var contains the Anthropic-proxy base URL;
- optionally which env var overrides the model.

This is different from the OpenAI-compatible `OPENAI_*` contract.

## Example: anthropic proxy using Anthropic-native auth and base URL config

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
    setupPrompt: 'Paste your Acme Anthropic proxy token.',
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

Why this is the right shape:

- the route keeps the Anthropic-native contract instead of pretending to be
  OpenAI-compatible;
- auth/base URL/model env wiring is explicit;
- the descriptor default-exports typed data and leaves registration to the
  loader;
- the transport family is encoded through `transportConfig.kind`.

## How anthropic proxies differ from OpenAI-compatible gateways

Anthropic proxies:

- use `defineAnthropicProxy`;
- use `classification: 'anthropic-proxy'`;
- use `transportConfig.kind: 'anthropic-proxy'`;
- keep Anthropic-native auth/base-URL env contracts in `envVarConfig`;
- should continue down Anthropic-family routing/transport behavior.

OpenAI-compatible gateways:

- use `defineGateway`;
- use `transportConfig.kind: 'openai-compatible'` or `local`;
- rely on OpenAI-compatible request/response shaping;
- do not use `envVarConfig` for Anthropic-native auth/base-URL wiring.

If the upstream expects OpenAI-compatible JSON bodies, it is not an anthropic
proxy even if it can reach Claude-family models.

## Current repo note

The `src/integrations/anthropicProxies/` directory already exists as the future
home for this descriptor type, but the current branch still focuses on vendors,
gateways, brands, and models first. That means the guide is authoring-ready
even though the repo has not yet shipped live proxy descriptors.

## What not to do

Avoid these patterns:

- documenting an Anthropic-native route as an OpenAI-compatible gateway;
- hiding the env contract instead of declaring it in `envVarConfig`;
- calling registry mutation helpers directly from the descriptor file;
- flattening the route into a generic transport kind when the external API
  contract is actually Anthropic-native.

## Verification checklist

Before calling an anthropic-proxy doc update complete:

- the example uses `defineAnthropicProxy`;
- the env contract is explicit through `envVarConfig`;
- the guide explains Anthropic-native auth/base URL expectations;
- the guide explains how the proxy differs from an OpenAI-compatible gateway;
- the transport family stays encoded as `transportConfig.kind:
  'anthropic-proxy'`.
