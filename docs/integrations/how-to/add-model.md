# How To Add a Model

Provider JSON catalogs under `src/integrations/modelCatalog/providers/` are the
source of truth for model facts: labels, aliases, capabilities, effort, limits,
pricing, visibility, and endpoint selection. Add or update a model there first.
Only add TypeScript transport code when the provider needs new auth, routing,
request execution, or response parsing behavior.

## Step-by-step

1. Pick the provider catalog.
   Edit the JSON file for the provider or gateway that offers the model, such as
   `anthropic.json`, `openai.json`, `github-copilot.json`, or
   `nvidia-nim.json`.
2. Add or update the model entry.
   Include the model id, label, aliases, visibility, limits, effort, pricing,
   capabilities, compatibility metadata, and endpoint selection that apply to
   that provider.
3. Reuse provider defaults and templates.
   Put shared provider behavior in `defaults` or `templates` instead of copying
   the same fields across every model entry.
4. Configure endpoints in the catalog.
   Use a model-level `endpoint` when one provider exposes different model
   families through different paths or protocols.
5. Add shared TypeScript descriptors only when needed.
   Use `src/integrations/models/` for optional shared glossary metadata across
   multiple provider catalogs. Do not use it as the first place to list a
   provider's offered models.
6. Add transport code only for new runtime behavior.
   TypeScript transport code is for new auth, routing, request execution, or
   response parsing behavior. Plain model facts belong in provider JSON.

## Provider catalog example

```json
{
  "models": {
    "acme-chat": {
      "label": "Acme Chat",
      "classification": ["chat", "coding"],
      "endpoint": "chatCompletions",
      "limits": {
        "contextWindow": 128000,
        "maxOutputTokens": {
          "default": 8192,
          "upperLimit": 32768
        }
      },
      "effort": {
        "scheme": "openai",
        "supported": true,
        "levels": ["low", "medium", "high"],
        "defaultLevel": "medium"
      },
      "capabilities": {
        "streaming": true,
        "functionCalling": true,
        "jsonMode": true,
        "reasoning": true
      },
      "visibility": {
        "tiers": ["thirdParty"],
        "defaultFor": ["main"]
      }
    }
  }
}
```

## Endpoint example

Use catalog endpoints when a provider has multiple API paths.

```json
{
  "endpoints": {
    "chatCompletions": {
      "path": "/v1/chat/completions",
      "protocol": "openai-chat-completions",
      "streaming": true
    },
    "responses": {
      "path": "/v1/responses",
      "protocol": "openai-responses",
      "streaming": true
    }
  },
  "models": {
    "acme-reasoner": {
      "label": "Acme Reasoner",
      "endpoint": "responses",
      "capabilities": {
        "reasoning": true,
        "streaming": true
      }
    }
  }
}
```

## Shared descriptors

Add or update a shared descriptor under `src/integrations/models/` only when the
metadata is useful across multiple provider catalogs or when the model deserves
a stable glossary entry of its own.

Good reasons to add a shared descriptor:

- the same conceptual model appears across multiple vendors or gateways;
- multiple catalogs should share a stable `modelDescriptorId`;
- the model needs reusable brand or family metadata beyond one provider JSON.

Shared descriptors answer what the model is. Provider catalogs answer where it
is offered and exactly how it should be called.

## Model lookup and fallback behavior

Model lookup should prefer:

1. provider catalog metadata from
   `src/integrations/modelCatalog/providers/*.json`;
2. shared descriptor enrichment when a catalog entry references a shared model;
3. legacy global descriptors for custom or OpenAI-compatible compatibility
   paths;
4. documented env overrides from `src/utils/model/openaiContextWindows.ts`
   (`CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS` and
   `CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS`).

`openaiContextWindows.ts` is compatibility glue for user-provided env overrides.
It should not grow a second built-in model table. Built-in model limits belong
in provider JSON catalogs.

## What not to do

Avoid these patterns:

- adding provider model facts to scattered TypeScript constants;
- turning shared model files into provider availability lists;
- assuming a shared model descriptor means every gateway supports it;
- using compatibility maps as a substitute for provider catalog entries;
- adding built-in model limits to `src/utils/model/openaiContextWindows.ts`;
- adding TypeScript transport code for facts that the catalog schema can
  represent.

## Verification checklist

Before calling a model update complete:

- the provider JSON entry includes all model facts needed by runtime and UI
  lookups;
- provider defaults or templates are used for repeated metadata;
- endpoint selection is configured in JSON when the provider has multiple paths;
- shared descriptors are added only for reusable cross-provider identity;
- no new built-in model table was added outside
  `src/integrations/modelCatalog/providers/`;
- catalog validation and relevant provider/model tests pass.
