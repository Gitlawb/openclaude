# Integration Reference Samples

## Purpose

This file gathers descriptor-plus-provider-catalog sample patterns in one
place. Replace ids, env vars, labels, and URLs with real route-specific values
before shipping them.

Provider model facts belong in
`src/integrations/modelCatalog/providers/<provider>.json`. Descriptors define
the route, auth/setup, and transport contract. Provider JSON files define model
availability, defaults, capabilities, limits, effort, pricing, endpoints, and
aliases.

When adding a brand-new provider JSON file, run
`bun run integrations:generate`. The generator discovers provider JSON files
and rewrites `src/integrations/modelCatalog/providerCatalogs.generated.ts`, so
the bundled CLI still gets static imports without a hand-maintained
registration list.

## Sample 1: Minimal direct vendor

Use this when the route is the canonical first-party vendor endpoint and does
not need custom model-routing behavior in the descriptor.

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme',
  label: 'Acme AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme.example/v1',
  requiredEnvVars: ['ACME_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  usage: {
    supported: false,
  },
})
```

## Sample 2: Direct vendor with model catalog

`src/integrations/vendors/acme-first-party.ts`

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme-first-party',
  label: 'Acme First-Party',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme-first-party.example/v1',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_FIRST_PARTY_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
      maxTokensField: 'max_completion_tokens',
    },
  },
  usage: {
    supported: false,
  },
})
```

`src/integrations/modelCatalog/providers/acme-first-party.json`

```json
{
  "schemaVersion": 1,
  "provider": "acme-first-party",
  "label": "Acme First-Party",
  "baseUrl": "https://api.acme-first-party.example/v1",
  "endpoints": {
    "chatCompletions": {
      "path": "/chat/completions",
      "protocol": "openai-chat-completions",
      "streaming": true
    }
  },
  "defaults": {
    "endpoint": "chatCompletions",
    "vendorId": "acme-first-party",
    "capabilities": {
      "streaming": true
    }
  },
  "models": {
    "acme-fast": {
      "label": "Acme Fast",
      "apiName": "acme-fast",
      "classification": ["chat", "coding"],
      "limits": {
        "contextWindow": 128000,
        "maxOutputTokens": {
          "default": 8192,
          "upperLimit": 32768
        }
      },
      "visibility": {
        "defaultFor": ["main"]
      }
    },
    "acme-reasoner": {
      "label": "Acme Reasoner",
      "apiName": "acme-reasoner",
      "classification": ["chat", "reasoning", "coding"],
      "capabilities": {
        "reasoning": true,
        "functionCalling": true,
        "jsonMode": true
      },
      "effort": {
        "scheme": "openai",
        "supported": true,
        "levels": ["low", "medium", "high"],
        "defaultLevel": "medium"
      }
    }
  }
}
```

## Sample 3: Local gateway with dynamic discovery

`src/integrations/gateways/acme-local.ts`

```ts
import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'acme-local',
  label: 'Acme Local',
  category: 'local',
  defaultBaseUrl: 'http://localhost:11434/v1',
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
      supportsApiFormatSelection: false,
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
    },
  },
  usage: {
    supported: false,
  },
})
```

`src/integrations/modelCatalog/providers/acme-local.json`

```json
{
  "schemaVersion": 1,
  "provider": "acme-local",
  "label": "Acme Local",
  "baseUrl": "http://localhost:11434/v1",
  "endpoints": {
    "chatCompletions": {
      "path": "/chat/completions",
      "protocol": "openai-chat-completions",
      "streaming": true
    },
    "models": {
      "path": "/models",
      "protocol": "models-list"
    }
  },
  "defaults": {
    "endpoint": "chatCompletions",
    "gatewayId": "acme-local",
    "request": {
      "maxTokensField": "max_tokens"
    }
  },
  "models": {
    "acme-local-latest": {
      "label": "Acme Local Latest",
      "apiName": "acme-local:latest",
      "visibility": {
        "defaultFor": ["main"]
      }
    }
  },
  "discovery": {
    "endpoint": "models",
    "parser": "openai-models-list",
    "cacheTtl": "1d",
    "refreshMode": "startup"
  }
}
```

## Sample 4: Hosted gateway with mixed models

Use `canonicalModelId` when a route-specific API name maps to a shared
conceptual model.

```json
{
  "schemaVersion": 1,
  "provider": "galaxy",
  "label": "Galaxy Gateway",
  "baseUrl": "https://api.galaxy.example/v1",
  "endpoints": {
    "chatCompletions": {
      "path": "/chat/completions",
      "protocol": "openai-chat-completions",
      "streaming": true
    }
  },
  "defaults": {
    "endpoint": "chatCompletions",
    "gatewayId": "galaxy"
  },
  "models": {
    "galaxy-gpt-5-mini": {
      "label": "GPT-5 Mini (via Galaxy)",
      "apiName": "galaxy/gpt-5-mini",
      "canonicalModelId": "gpt-5-mini",
      "visibility": {
        "defaultFor": ["main"]
      }
    },
    "galaxy-deepseek-r1": {
      "label": "DeepSeek R1 (via Galaxy)",
      "apiName": "galaxy/deepseek-r1",
      "canonicalModelId": "deepseek-reasoner",
      "classification": ["chat", "reasoning"],
      "capabilities": {
        "reasoning": true
      },
      "request": {
        "preserveReasoningContent": true,
        "requireReasoningContentOnAssistantMessages": true,
        "reasoningContentFallback": ""
      }
    }
  }
}
```

## Sample 5: Usage metadata

Usage support stays on descriptors because it describes provider account/quota
APIs, not individual model facts.

```ts
import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'acme',
  label: 'Acme AI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme.example/v1',
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['ACME_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
    },
  },
  usage: {
    supported: true,
    fetchModule: './usage/fetchAcmeUsage.js',
    parseModule: './usage/parseAcmeUsage.js',
  },
})
```

## Copy-paste safety checklist

Before promoting any sample into a real descriptor:

- replace placeholder ids, labels, env vars, and URLs;
- keep route model availability in provider JSON;
- run `bun run integrations:generate` after adding brand-new provider JSON
  files;
- let `validateCatalogs.test.ts` derive provider inventory from JSON files;
- set exactly one provider JSON model with `visibility.defaultFor: ["main"]`;
- keep `transportConfig.kind` as the routing contract;
- keep `category` descriptive only;
- set OpenAI-compatible `supportsApiFormatSelection`,
  `supportsAuthHeaders`, and `maxTokensField` explicitly where required;
- keep `/usage` metadata honest about current runtime support;
- run catalog validation and the integration artifact check.
