# Phase 2E Drift Audit

Date: 2026-04-25
Branch: `cheeky-cooking-moon`

## Focused verification

- `bun test src/components/ProviderManager.test.tsx src/commands/provider/provider.test.tsx src/utils/providerValidation.test.ts src/integrations/discoveryService.test.ts src/commands/model/model.test.tsx`
- `bun test src/utils/providerDiscovery.test.ts src/utils/model/providers.test.ts src/services/api/openaiShim.test.ts src/utils/conversationRecovery.test.ts`

These runs cover representative `/provider` flows, `/model` refresh behavior, validation timing, local discovery, runtime-provider detection, OpenAI-shim metadata routing, and resume handling.

## Remaining switch inventory

| File | Switch / branch | Classification | Reason |
| --- | --- | --- | --- |
| `src/commands/provider/provider.tsx` | `switch (profile)` in `buildSavedProfileSummary()` | Intentional | Saved-profile summaries still need to read different env contracts for Gemini, Mistral, Codex, Ollama, and generic OpenAI-compatible profiles. Descriptor-backed labels/defaults are already used where applicable. |
| `src/commands/provider/provider.tsx` | `switch (step.name)` in the wizard renderer | Intentional | UI state machine, not provider metadata routing. |
| `src/components/ProviderManager.tsx` | `switch (value)` in the main menu handler | Intentional | Menu action dispatcher for provider management actions. |
| `src/components/ProviderManager.tsx` | `switch (screen)` in the top-level renderer | Intentional | UI screen state machine. |
| `src/utils/providerValidation.ts` | `switch (validation.kind)` | Intentional | Descriptor metadata now selects the validation target; this switch only executes the remaining procedural validation strategies. |
| `src/utils/model/providers.ts` | `switch (activeRouteId)` | Intentional compatibility bridge | Maps descriptor-backed routes onto the legacy `APIProvider` surface that existing callers still consume. |
| `src/integrations/discoveryService.ts` | `switch (discovery.kind)` | Intentional | Executes the declarative discovery strategy chosen by descriptor metadata. |
| `src/integrations/discoveryService.ts` | `switch (readinessKind)` | Intentional | Executes the readiness probe strategy chosen by descriptor metadata. |
| `src/integrations/routeMetadata.ts` | `switch (kind)` in `getRouteProviderTypeLabel()` | Intentional | Presentation-only mapping from transport kind to user-facing copy. |

## Additional explicit provider-branch inventory

| File | Branch | Classification | Reason |
| --- | --- | --- | --- |
| `src/commands/provider/provider.tsx` | `buildCurrentProviderSummary()` env-flag checks for Gemini, Mistral, GitHub, and OpenAI mode | Intentional | Current-provider summaries still have to read provider-specific env contracts before the OpenAI-compatible fallback path. Descriptor-backed labels are already used where available. |
| `src/integrations/routeMetadata.ts` | `resolveActiveRouteIdFromEnv()` env-flag precedence for Gemini, Mistral, GitHub, Bedrock, Vertex, and OpenAI mode | Intentional compatibility bridge | Active-route detection still has to honor the externally visible env flags that bootstrap and saved-profile activation already emit. |
| `src/services/api/openaiShim.ts` | `createOpenAIShimClient()` env remapping for Gemini, Mistral, GitHub, and Bankr | Intentional compatibility shim | These branches normalize provider-specific env vars onto the shared OpenAI-compatible transport entrypoint before request execution. |
| `src/services/api/openaiShim.ts` | auth/header special-casing for Azure and Bankr | Intentional | These are request-contract exceptions, not metadata-selection drift. Azure requires `api-key`, and Bankr requires `X-API-Key`. |
| `src/utils/conversationRecovery.ts` | foundry / Anthropic-native preservation gate | Intentional | Resume handling still needs to preserve Anthropic-native thinking blocks for native transports while stripping them for OpenAI-compatible ones. |

## Audit conclusion

No stale provider-metadata switch statements remain in the Phase 2 runtime, validation, discovery, `/provider`, or `/model` surfaces audited here.

The remaining explicit branches are all one of:

- UI state machines
- compatibility bridges for legacy external surfaces
- runtime executors for descriptor-selected strategies
- provider-specific env-contract summaries that still need to read non-unified env vars

Follow-up hardening completed during audit review:

- replaced the stale `anthropic` vs `openai-compatible` saved-profile wording in `ProviderManager`'s set-active/edit/delete picker with the descriptor-backed route provider-type label

The known intentional runtime exception categories remain:

- `github`
- `mistral`
- `bedrock`
- `vertex`
- `foundry`
- env-only MiniMax fallback
- env-only NVIDIA NIM fallback
