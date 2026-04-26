# Phase 3D Final Audit

Date: 2026-04-25
Branch: `cheeky-cooking-moon`

## Scope

This audit closes Phase 3 by verifying that the remaining provider-specific
branches after Phase 3C are either:

- intentional long-term runtime exceptions,
- temporary compatibility bridges for the current env/config contract, or
- true missed migration work that should still be cleaned up before Phase 4.

The starting point was the earlier [Phase 2E drift audit](./phase-2e-drift-audit.md),
plus the Phase 3B and 3C branch work that renamed compatibility surfaces and
consolidated env shaping.

## Remaining provider-specific exception inventory

| Area | File | Classification | Why it still exists |
| --- | --- | --- | --- |
| Active-route detection from shell/session env | `src/integrations/routeMetadata.ts` | Temporary compatibility bridge | `resolveActiveRouteIdFromEnv()` still has to honor `CLAUDE_CODE_USE_*` flags and OpenAI-compatible base-url/env fallback because startup, saved-profile activation, and `--provider` still expose that env contract publicly. |
| `--provider` CLI env shaping | `src/utils/providerFlag.ts` | Temporary compatibility bridge | The CLI flag still writes the legacy env contract directly. Descriptor defaults are already consulted, but the surface remains env-first until a later config/bootstrap redesign replaces it. |
| Legacy provider-category surface | `src/utils/model/providers.ts` | Temporary compatibility bridge | Existing status/model/runtime callers still consume `APIProvider`/`LegacyAPIProvider` categories. This file also keeps the env-only MiniMax and NVIDIA NIM recovery paths for older shell setups. |
| Current-provider summaries in `/provider` | `src/commands/provider/provider.tsx` | Temporary compatibility bridge | `buildCurrentProviderSummary()` and `buildSavedProfileSummary()` still need to read provider-specific env/profile fields because the runtime env contract is not fully unified yet. |
| Startup banner provider detection | `src/components/StartupScreen.ts` | Temporary compatibility bridge | The banner still derives labels from env flags, base URLs, and model heuristics so it can describe the active process state before the wider descriptor presentation cleanup lands. |
| OpenAI-compatible shim credential aliasing | `src/services/api/openaiShim.ts` | Intentional compatibility shim | Gemini, Mistral, GitHub, and Bankr still need provider-specific auth/header shaping at the transport boundary even after base URL/model selection moved under descriptor/runtime metadata. |
| Route-specific OpenAI shim transport quirks | `src/services/api/openaiShim.ts`, `src/integrations/runtimeMetadata.ts` | Intentional long-term exception | DeepSeek and Moonshot/Kimi still need `reasoning_content`, `max_tokens`, and `store` handling; GitHub still has Copilot vs Models behavior; Gemini still has thought-signature/auth handling. These are API-contract differences, not stale metadata switches. |
| Azure OpenAI and Bankr request auth | `src/services/api/openaiShim.ts` | Intentional long-term exception | Azure requires `api-key` and deployment-style URLs; Bankr requires `X-API-Key`. These are provider-specific HTTP contracts. |
| GitHub native Claude mode | `src/utils/model/providers.ts`, `src/integrations/runtimeMetadata.ts` | Intentional long-term exception | GitHub is a dual-mode route: Claude models can use Anthropic-native message format, while other GitHub traffic stays on the OpenAI/Codex path. |
| Mistral dedicated route behavior | `src/integrations/gateways/mistral.ts`, `src/services/api/providerConfig.ts`, `src/services/api/openaiShim.ts` | Intentional long-term exception | Mistral still rides the OpenAI shim but keeps its own env contract and request-shaping rules. The gateway descriptor already documents that it must not be flattened into generic OpenAI-compatible behavior. |
| Native Anthropic-family SDK clients | `src/services/api/client.ts` | Intentional long-term exception | Bedrock, Vertex, and Foundry use dedicated Anthropic-family SDK/auth flows, not the generic OpenAI-compatible transport. |
| Foundry runtime behavior | `src/services/api/client.ts`, `src/utils/conversationRecovery.ts`, `src/tools/WebSearchTool/WebSearchTool.ts` | Intentional long-term exception | Foundry remains an Anthropic-native env-driven runtime outside the descriptor route inventory. Its auth, thinking preservation, and native web-search behavior still need explicit handling. |
| Native web-search gating | `src/tools/WebSearchTool/WebSearchTool.ts`, `src/tools/WebSearchTool/providers/index.ts` | Intentional long-term exception | Anthropic native web search is only valid on first-party Anthropic, Vertex, and Foundry native paths; OpenAI-compatible routes must not silently pretend to support the native tool. |
| MiniMax `/usage` handling | `src/services/api/minimaxUsage/fetch.ts` | Intentional long-term exception | MiniMax exposes dedicated usage endpoints that are not modeled by the generic vendor usage path yet. The descriptor correctly says usage is supported, but execution remains vendor-specific. |
| Conversation resume thinking preservation | `src/utils/conversationRecovery.ts` | Intentional long-term exception | Resume/recovery still has to preserve Anthropic-native thinking blocks for native transports while stripping them for OpenAI-compatible routes. |

## Missed migration work check

No new missed runtime migration paths were identified in the Phase 3D audit.

The remaining audited items all fall into one of two buckets:

- intentional request/runtime capability differences, or
- temporary compatibility bridges for the current env/config/bootstrap contract.

The main Phase 3 documentation gap was the missing architecture note that
captures those buckets explicitly. Phase 3D closes that gap in
`docs/architecture/integrations.md`.

## Exit summary

Phase 3 can be considered complete on `cheeky-cooking-moon` with the current
exception set. Future cleanup should not try to erase the intentional entries
above without first proving equivalent transport behavior, and should treat the
temporary bridges as follow-on work tied to a larger env/config contract
revision rather than ad hoc local simplifications.
