# OpenClaude Descriptor Migration — Progress Tracker

**Master Plan**: [`plan/cheeky-cooking-moon.md`](./cheeky-cooking-moon.md)
**Current Phase**: Phase 3C — Env-Shaping Consolidation (complete on branch)
**Next Planned Phase**: Phase 3D — Final Audit and Documentation Pass
**Goal**: Establish the descriptor system without regressing current behavior. Get all metadata into one place before deeper runtime migration starts.
**Last Updated**: 2026-04-25 21:19

---

## Phase 1 Exit Criteria

- [x] Registry exists and loads
- [x] Every currently supported integration has descriptor coverage
- [x] Preset defaults and `/usage` can read from descriptors
- [x] Existing saved profiles still deserialize and activate

---

## Phase 1A: Registry Skeleton

**Status**: `COMPLETE`

- [x] Create `src/integrations/descriptors.ts` — all core types from master plan section "Core Descriptor Types"
- [x] Create `src/integrations/define.ts` — `defineVendor`, `defineGateway`, `defineAnthropicProxy`, `defineBrand`, `defineModel`, `defineCatalog`
- [x] Create `src/integrations/registry.ts` — Maps, register/get/list APIs, catalog helpers, `validateIntegrationRegistry`
- [x] Create `src/integrations/index.ts` — loader entrypoint that imports and registers all descriptor modules
- [x] Create `src/integrations/compatibility.ts` — `PRESET_VENDOR_MAP`, `vendorIdForPreset`, `gatewayIdForPreset`, `routeForPreset`
- [x] Create `src/integrations/registry.test.ts` — register/retrieve, duplicate ids, missing refs, transport validation, usage delegates, enrichment
- [x] Run registry tests — all pass (23/23)
- [x] Run `tsc --noEmit` on new files — zero errors in `src/integrations/`

---

## Phase 1B: Descriptor Inventory for Vendors and Gateways

**Status**: `COMPLETE`

### Vendors (first-party and direct)
- [x] `src/integrations/vendors/anthropic.ts` — native, usage supported
- [x] `src/integrations/vendors/openai.ts` — openai-compatible, static/hybrid catalog
- [x] `src/integrations/vendors/gemini.ts` — gemini-native
- [x] `src/integrations/vendors/moonshot.ts` — openai-compatible
- [x] `src/integrations/vendors/deepseek.ts` — openai-compatible, static/hybrid catalog
- [x] `src/integrations/vendors/minimax.ts` — usage supported
- [x] `src/integrations/vendors/bankr.ts` — openai-compatible
- [x] `src/integrations/vendors/zai.ts` — skipped (PR #896 not landed)

### Gateways (hosted and local)
- [x] `src/integrations/gateways/ollama.ts` — local, dynamic discovery
- [x] `src/integrations/gateways/lmstudio.ts` — local, dynamic discovery
- [x] `src/integrations/gateways/atomic-chat.ts` — local, dynamic discovery
- [x] `src/integrations/gateways/openrouter.ts` — aggregating, dynamic/hybrid
- [x] `src/integrations/gateways/together.ts` — aggregating
- [x] `src/integrations/gateways/groq.ts` — aggregating
- [x] `src/integrations/gateways/azure-openai.ts` — hosted
- [x] `src/integrations/gateways/dashscope-cn.ts` — hosted
- [x] `src/integrations/gateways/dashscope-intl.ts` — hosted
- [x] `src/integrations/gateways/nvidia-nim.ts` — hosted
- [x] `src/integrations/gateways/custom.ts` — hosted, empty static catalog
- [x] `src/integrations/gateways/kimi-code.ts` — hosted (additional preset not in master inventory)

### Special-case surfaces (document unresolved nuances inline)
- [x] `src/integrations/gateways/github.ts` — special native-Claude path
- [x] `src/integrations/gateways/bedrock.ts` — bedrock transport
- [x] `src/integrations/gateways/vertex.ts` — vertex transport
- [x] `src/integrations/gateways/mistral.ts` — dedicated runtime, not generic openai-compatible

### Verification
- [x] Cross-check migration inventory table — every preset has a descriptor file
- [x] `validateIntegrationRegistry()` returns zero errors
- [x] Every route has `transportConfig.kind` assigned
- [x] Every gateway/direct vendor has catalog strategy declared

---

## Phase 1C: Shared Brand and Model Index Seeding

**Status**: `COMPLETE`

### Brand descriptors
- [x] `src/integrations/brands/claude.ts`
- [x] `src/integrations/brands/gpt.ts`
- [x] `src/integrations/brands/kimi.ts`
- [x] `src/integrations/brands/deepseek.ts`
- [x] `src/integrations/brands/llama.ts`
- [x] `src/integrations/brands/qwen.ts`

### Shared model index
- [x] `src/integrations/models/claude.ts` — sonnet, opus, haiku variants
- [x] `src/integrations/models/gpt.ts` — gpt-4o, gpt-4o-mini, etc.
- [x] `src/integrations/models/kimi.ts`
- [x] `src/integrations/models/deepseek.ts` — chat + reasoner variants
- [x] `src/integrations/models/llama.ts`
- [x] `src/integrations/models/qwen.ts`

### Documentation
- [x] Inline comments note fallback to `openaiContextWindows.ts`
- [x] Inline comments note gateway onboarding does not require editing model index files

---

## Phase 1D: Config and Preset Compatibility

**Status**: `COMPLETE`

- [x] Widen `Providers` from closed union to `string` in `src/utils/config.ts`
- [x] Stop normalizing unknown stored providers back to `'openai'` in `src/utils/providerProfiles.ts`
- [x] Add `resolveProfileRoute(provider)` helper returning `{ vendorId, gatewayId?, routeId }`
- [x] Update `applyProviderProfileToProcessEnv()` to use route-resolution helper with explicit fallback
- [x] Preserve Bedrock/Vertex/GitHub runtime exceptions during descriptor-backed profile activation
- [x] Serialize descriptor-backed startup fallback using legacy-compatible startup kinds so saved profiles still reload
- [x] All `providerProfiles.test.ts` pass (43/43)

---

## Phase 1E: CLI Flag and Usage Surface Migration

**Status**: `COMPLETE`

- [x] Derive valid provider names from descriptors/compatibility in `src/utils/providerFlag.ts`
- [x] Preserve `--provider ollama`, `--provider minimax` semantics
- [x] Implement `getUsageDescriptor(activeId)` in `src/commands/usage/index.ts`
- [x] Anthropic usage supported, MiniMax preserved, unsupported shows neutral fallback
- [x] Add usage routing tests — supported, unsupported, gateway delegation

---

## Phase 1F: Phase-1 Verification and Merge Pass

**Status**: `IN_PROGRESS`

- [x] Registry unit and validation tests pass
- [x] Compatibility mapping tests — every preset has valid descriptor mapping
- [x] Saved-profile compatibility tests — old profiles deserialize, unknown providers preserved
- [x] Run `src/utils/*provider*.test.ts` — all green
- [x] Run `src/utils/model/*.test.ts` — all green
- [x] Run profile startup/env tests — all green
- [ ] `tsc --noEmit` across project — zero errors
- [x] Cross-check: no provider from migration inventory is missing a descriptor file

Notes:
- Re-ran targeted Phase 1E/1F verification on 2026-04-25 after the latest compatibility/usage/provider changes, including loader/registry sanity coverage; all targeted suites are green.
- Filtered `bun run typecheck` output for the Phase 1 files changed in this branch is now clean.
- Repo-wide `bun run typecheck` is still red in unrelated existing areas such as `src/__tests__/providerCounts.test.ts`, `src/assistant/sessionHistory.ts`, `src/bootstrap/state.ts`, and multiple `src/bridge/` and `src/cli/` files; that baseline issue is not a new Phase 1 blocker introduced by this branch.
- Full review follow-up on 2026-04-25 20:01 fixed skipped provider-surface updates in `src/utils/status.tsx`, `src/utils/swarm/teammateModel.ts`, `src/utils/model/configs.ts`, and `src/utils/model/deprecation.ts`, with new focused tests in `src/utils/status.test.ts` and `src/utils/swarm/teammateModel.test.ts`.
- After the repo-wide typecheck blocker is resolved or explicitly waived, finish Phase 1 by rerunning `bun run typecheck`, updating the exit criteria, and checking `1F complete`.

---

## Phase 1 Merge Checkpoints

- [x] **1A merged** — registry skeleton + tests checkpoint landed on `cheeky-cooking-moon`
- [x] **1B+1C merged** — descriptor inventory + brand/model index checkpoint landed on `cheeky-cooking-moon`
- [x] **1D merged** — config compatibility checkpoint landed on `cheeky-cooking-moon`
- [x] **1E merged** — CLI/usage checkpoint landed on `cheeky-cooking-moon`
- [ ] **1F complete** — all tests green, exit criteria met, ready for Phase 2

---

## Phase 2: Runtime Metadata Adoption

**Status**: `COMPLETE`

**Goal**: Move decision-making logic onto descriptors so runtime surfaces stop duplicating provider rules.

### Phase 2 Exit Criteria

- [x] Validation, discovery hints, preset metadata, and runtime affordances are descriptor-backed
- [x] UI and command surfaces read shared metadata instead of bespoke switches

### Phase 2 Entry Blockers

- [x] Phase 1F is completed, or the repo-wide `tsc --noEmit` baseline is explicitly accepted as pre-existing debt
- [x] Phase 1 merge checkpoints are confirmed in branch order on `cheeky-cooking-moon`
- [x] Phase 1 exit criteria are reconciled with current behavior before Phase 2 consumer migrations begin

Notes:
- Once the entry blockers clear, start `2A` and `2A.5` first; they are the planned front door for Phase 2 work.
- `2B` depends on `2A.5`, `2C` depends on `2A.5`, `2D` should coordinate with `2A` and `2B`, and `2E` stays last.
- `2A` was completed on-branch on 2026-04-25 by explicit user direction before the broader entry blockers were formally reconciled; keep that sequencing note visible while the remaining Phase 2 packets stay gated behind stable follow-on prerequisites.
- Reconciled during the 2026-04-25 tracker/code review pass:
  - repo-wide `bun run typecheck` was re-run and the remaining failures were explicitly accepted as broader pre-existing repo debt rather than Phase 1/2 regressions
  - Phase 1 checkpoints were confirmed on-branch in commit order (`d557c6b`, `0d0c437`, `9c02a21`, `4f3411b`, `cff7bfa`, `9f5fd87`, `b332b3f`)
  - Phase 1 exit criteria were checked against the live branch state and marked accordingly

### Phase 2 Recommended Sequence

- [x] Migrate read-only metadata consumers first
- [x] Migrate env/routing helpers second
- [x] Retire duplicated logic only after parity is verified

---

## Phase 2A: Validation Metadata Migration

**Status**: `COMPLETE`

- [x] Inventory current validation rules by provider
- [x] Classify which rules are pure metadata and which are true runtime logic
- [x] Move metadata-like rules into descriptors
- [x] Keep truly procedural rules in helper functions where needed
- [x] Route validation entry points through descriptor-backed metadata

Notes:
- First work to start after the Phase 2 entry blockers clear.
- Keep a short migration note listing which validation rules stay procedural so later cleanup does not try to over-normalize them.
- Inventory/classification result: descriptor-backed targets can cover OpenAI, Gemini, GitHub, Mistral, MiniMax, and Bankr validation selection; Codex transport validation and GitHub token inspection remain procedural.
- Implementation in branch: `ValidationMetadata` now includes routing hints, vendor/gateway descriptors declare their own validation-selection metadata, and `src/utils/providerValidation.ts` now resolves validation targets from descriptor metadata instead of a hardcoded provider-id list.
- Procedural rules intentionally kept in helpers: Codex auth depends on transport resolution plus auth/account state, and GitHub token inspection still needs runtime token parsing/expiry checks after descriptor target selection.
- Focused verification on 2026-04-25 is green:
  - `bun test src/utils/providerValidation.test.ts src/utils/providerProfile.test.ts`
  - `bun test src/utils/providerProfiles.test.ts src/integrations/registry.test.ts src/integrations/index.test.ts`
  - filtered `bun run typecheck` for the touched Phase 2A files returned clean output
- Additional 2A regression coverage now verifies descriptor-driven precedence for Mistral vs stale OpenAI mode, GitHub vs OpenAI mode, and fallback validation for generic OpenAI-compatible routes such as Moonshot.

---

## Phase 2A.5: Discovery Cache Service

**Status**: `COMPLETE`

- [x] Create `src/integrations/discoveryCache.ts`
- [x] Create `src/integrations/discoveryCache.test.ts`
- [x] Implement `parseDurationString` with `m`, `h`, `d` support and raw numbers
- [x] Implement `getCachedModels`, `setCachedModels`, `isCacheStale`
- [x] Implement `recordDiscoveryError` with stale-data preservation
- [x] Implement `clearDiscoveryCache` (per-route and all-routes)
- [x] Implement atomic writes (temp + rename)
- [x] Implement in-memory locking for concurrent access
- [x] Implement schema version + migration stub
- [x] Implement corruption fallback (empty cache, no crash)
- [x] Verify parse and TTL behavior in unit tests
- [x] Verify atomic write does not corrupt existing cache on crash mid-write
- [x] Verify concurrent writes are serialized
- [x] Verify `recordDiscoveryError` preserves stale cache data

Notes:
- This can begin alongside `2A` once Phase 2 entry blockers clear.
- `2B` and `2C` should not start wiring discovery caching until this packet is complete enough to provide stable helper APIs.
- Landed in branch: `src/integrations/discoveryCache.ts` stores per-route model discovery entries under `model-discovery-cache.json` in the Claude config home, with atomic temp-file writes, versioned schema loading, corruption fallback, and a serialized in-memory write lock.
- Current helper behavior: `getCachedModels(routeId, ttlMs)` stays fresh-by-default, and `getCachedModels(routeId, ttlMs, { includeStale: true })` exposes preserved stale entries or error-only entries so later `/model` consumers can surface fallback data and refresh failures together.
- Focused verification on 2026-04-25 is green:
  - `bun test src/integrations/discoveryCache.test.ts`
  - filtered `bun run typecheck` for `src/integrations/discoveryCache*.ts` returned clean output
- Follow-up hardening on 2026-04-25:
  - MiniMax validation routing now recognizes both `api.minimax.io` and `api.minimax.chat`
  - stale discovery cache entries are readable through the public helper API when callers opt in with `includeStale: true`

---

## Phase 2B: Discovery and Readiness Metadata Migration

**Status**: `COMPLETE`

- [x] Map current readiness flows for Ollama, Atomic Chat, and other local/openai-compatible providers
- [x] Define which probe behaviors can be declared as metadata
- [x] Keep actual probe execution in code, but drive probe selection from descriptors
- [x] Add a model discovery service that can run declarative `catalog.discovery` configs
- [x] Consume `discoveryCache.ts` in the discovery service
- [x] Wire `setCachedModels` / `getCachedModels` into declarative `catalog.discovery` execution
- [x] Implement deterministic hybrid merge behavior where curated descriptor entries override discovered metadata
- [x] Implement built-in `discovery.kind: 'openai-compatible'` support for standard `/v1/models` discovery
- [x] Ensure OpenAI-compatible discovery uses the route's base URL and descriptor/profile-resolved headers automatically
- [x] Reserve custom discovery functions for non-standard response shapes only
- [x] Verify local provider labels still render correctly
- [x] Verify readiness messages still render correctly

Notes:
- `2A` and `2A.5` are complete, so this packet is now active on-branch.
- Completed 2B work in branch:
  - `StartupMetadata.probeReadiness` is now a typed descriptor field (`ReadinessProbeKind`) instead of a free-form string.
  - `ollama`, `atomic-chat`, `lmstudio`, and `openrouter` descriptors now declare readiness/discovery metadata directly.
  - `src/integrations/discoveryService.ts` now runs descriptor-backed discovery, caches results through `discoveryCache.ts`, preserves stale fallback, and merges curated hybrid entries ahead of discovered duplicates.
  - `src/utils/providerDiscovery.ts` now exports `probeOllamaModelCatalog()` so the service can distinguish unreachable Ollama from reachable-but-empty Ollama catalogs.
  - `src/components/ProviderManager.tsx` and `src/commands/provider/provider.tsx` now call `probeRouteReadiness()` instead of reaching directly into provider-specific probe helpers.
  - `src/services/api/bootstrap.ts` now uses `discoverModelsForRoute()` for recognized descriptor-backed local routes and falls back to the legacy generic `/models` fetch for custom local endpoints.
  - `resolveDiscoveryRouteIdFromBaseUrl()` now maps known descriptor routes by default base URL and local-route heuristics so bootstrap can share the cached discovery path with runtime callers.
- Focused verification completed on 2026-04-25:
  - `bun test src/integrations/discoveryService.test.ts`
  - `bun test src/components/ProviderManager.test.tsx`
  - `bun test src/commands/provider/provider.test.tsx`
  - `bun test src/utils/providerDiscovery.test.ts src/integrations/registry.test.ts src/integrations/index.test.ts`
  - filtered `bun run typecheck` for `src/integrations/discoveryService.ts`, `src/integrations/discoveryService.test.ts`, `src/components/ProviderManager.tsx`, `src/components/ProviderManager.test.tsx`, `src/commands/provider/provider.tsx`, `src/services/api/bootstrap.ts`, and `src/utils/providerProfile.ts` returned `FILTER_CLEAN`
- Verification note:
  - the focused `/provider` verification surfaced an env-precedence regression in `applySavedProfileToCurrentSession()`; fixing it keeps explicit provider env selections authoritative while saved-profile activation is attempted.

---

## Phase 2C: Provider UI Metadata Migration

**Status**: `COMPLETE`

- [x] Replace hardcoded preset labels/defaults with descriptor lookups
- [x] Drive auth/setup prompts from descriptor metadata
- [x] Wire custom-header capability flags into the custom-provider flow
- [x] Make `/model` read active route catalog entries instead of global model availability
- [x] Call `getCachedModels` before rendering `/model` for dynamic/hybrid routes so cached discovered models appear immediately
- [x] Call `isCacheStale` to trigger background refresh when picker opens
- [x] Add `/model refresh` command to force model discovery refresh for the active route
- [x] Add an in-picker refresh action for model discovery, such as pressing `r`
- [x] Call `clearDiscoveryCache(routeId)` from `/model refresh` and in-picker refresh handlers
- [x] Show non-blocking refresh states: loading, success, failure with stale cache, and no changes found
- [x] Surface `entry.error` in the picker UI when refresh failed but stale data exists
- [x] Keep any UX-only branching that is truly presentational
- [x] Verify the `/provider` experience remains understandable after metadata migration

Notes:
- Unblock after `2A.5` and the first round of `2B` discovery/readiness helpers are stable enough for UI consumers.
- Work this packet in two slices: descriptor-backed provider labels/setup first, then `/model` cache/refresh UX second.
- Active work resumed on 2026-04-25. First slice is migrating preset labels/defaults/setup copy onto descriptor metadata before rewiring `/model` to the discovery cache service.
- Focused Phase 2C verification resumed on 2026-04-25 18:24 after isolating a combined-run Bun mock leak from `src/commands/model/model.test.tsx`; the `/model` tests now rely on the real OpenRouter descriptor route metadata so `/provider` summary tests keep seeing the real OpenAI and Gemini labels during the shared targeted run.
- Phase 2C was completed on 2026-04-25 18:30 after the shared targeted suite, focused `/provider` and `/model` test reruns, filtered typecheck pass for the touched Phase 2C files, and regression checks for `src/integrations/discoveryCache.test.ts` plus `src/utils/providerValidation.test.ts`.

---

## Phase 2D: Runtime Provider Detection Alignment

**Status**: `COMPLETE`

- [x] Define the boundary between `APIProvider` and descriptor ids
- [x] Decide which legacy runtime provider names stay externally visible
- [x] Map descriptor-backed state onto `getAPIProvider()` without breaking existing callers
- [x] Inventory current `openaiShim.ts` provider/base-url conditionals and classify which can become descriptor metadata
- [x] Preserve DeepSeek/Moonshot `reasoning_content` replay behavior from PR #895 if it has landed
- [x] If PR #895 has not landed, explicitly test whether the migration still covers its reported DeepSeek thinking-mode edge cases
- [x] Preserve Z.AI GLM Coding Plan behavior from PR #896 if it has landed
- [x] Move Z.AI-style `max_tokens`, `store` stripping, thinking request format, and `reasoning_content` gates into descriptor metadata where possible
- [x] Avoid assuming DeepSeek-like reasoning behavior only applies to direct DeepSeek URLs; gateways may expose models with the same requirement
- [x] Document exceptions such as `github`, `bedrock`, `vertex`, and `mistral`
- [x] Verify existing callers still receive expected provider categories

Notes:
- Unblock after `2A` and `2B` establish the descriptor-backed metadata that runtime detection will consume.
- Before starting, check whether PR `#895` or PR `#896` landed so this packet preserves the right transport quirks instead of duplicating stale assumptions.
- Active work resumed on 2026-04-25 18:41. The first implementation slice is aligning `getAPIProvider()` with descriptor-backed active-route resolution while preserving the legacy externally visible provider categories that existing callers still expect.
- Current runtime-migration target: move OpenAI-shim request shaping for `reasoning_content`, `max_tokens`, and `store` onto route/model transport metadata where possible, while keeping explicit procedural fallbacks only for cases that cannot yet be expressed by the current descriptor inventory.
- Completed on 2026-04-25 18:53:
  - `src/utils/model/providers.ts` now maps descriptor-backed active routes onto the legacy `APIProvider` categories, with explicit compatibility fallbacks kept only for `foundry`, env-only `NVIDIA_NIM`, and env-only MiniMax recovery.
  - `src/integrations/runtimeMetadata.ts` now centralizes runtime route/shim metadata resolution, merges route/model OpenAI-shim overrides, and exposes an Anthropic-native transport check used by resume handling.
  - direct DeepSeek, Moonshot, Kimi Code, Gemini, GitHub, Mistral, and local route quirks now come from descriptor-backed OpenAI-shim metadata instead of hand-coded base-url/provider conditionals in `openaiShim.ts`.
  - gateway-routed DeepSeek models now inherit the same reasoning-content, `max_tokens`, and `store` behavior without relying on direct DeepSeek base URLs.
  - GitHub Claude native transport is now treated as Anthropic-native during conversation recovery so thinking blocks are preserved for that path.
- Exception notes:
  - `github`, `mistral`, `bedrock`, and `vertex` remain explicit runtime exception categories because existing callers still consume those legacy provider names directly.
  - PR `#896` / Z.AI still has not landed in this branch, so the Z.AI-specific preservation check completed as a no-op audit rather than a code migration.
- Focused verification on 2026-04-25 is green:
  - `bun test src/utils/model/providers.test.ts src/utils/providerProfiles.test.ts src/utils/conversationRecovery.test.ts`
  - `bun test src/services/api/openaiShim.test.ts`
- Filtered `bun run typecheck` for the new runtime-metadata file is clean; broader filtered output still includes pre-existing noise in `src/services/api/openaiShim.test.ts` and `src/utils/conversationRecovery.ts`, which predates this packet.

---

## Phase 2E: Phase-2 Verification and Drift Audit

**Status**: `COMPLETE`

- [x] Run `/provider` flows for representative providers
- [x] Verify validation errors still appear at the right times
- [x] Verify local discovery still works
- [x] Audit remaining switch statements
- [x] Document whether each remaining switch is intentional or stale

Notes:
- Unblock only after `2A` through `2D` are complete enough to audit as one behavior slice.
- Treat this packet as the gate before any Phase 3 cleanup work starts.
- Active work resumed on 2026-04-25 18:59. Focused representative-provider verification is running across `/provider`, `/model`, validation, discovery, runtime detection, and resume/shim coverage before the remaining switch inventory is classified.
- Completed on 2026-04-25 19:09:
  - added representative `/provider` verification for descriptor-backed OpenRouter labeling plus Gemini and Mistral current-provider summaries in `src/commands/provider/provider.test.tsx`
  - added first-run Atomic Chat picker coverage in `src/components/ProviderManager.test.tsx` to confirm local discovery-backed provider setup still works
  - recorded the remaining switch inventory and classification in `plan/phase-2e-drift-audit.md`
- Follow-up hardening on 2026-04-25 19:18:
  - expanded `plan/phase-2e-drift-audit.md` to include the remaining intentional non-switch provider branches in `routeMetadata.ts`, `openaiShim.ts`, `provider.tsx`, and `conversationRecovery.ts`
  - replaced stale saved-profile picker wording in `src/components/ProviderManager.tsx` with the descriptor-backed route provider-type label and added focused regression coverage
- Review follow-up on 2026-04-25 20:01:
  - fixed skipped provider-category follow-through in `src/utils/status.tsx` so Status now covers `nvidia-nim` and `minimax`
  - fixed Mistral teammate fallback coverage in `src/utils/swarm/teammateModel.ts` by adding `mistral` entries to the shared model config table
  - filled out third-party provider placeholders in `src/utils/model/deprecation.ts` and added focused tests for the new status/teammate behavior
  - clarified that `src/utils/model/configs.ts` remains a transitional compatibility table for legacy `APIProvider` callers during Phase 2; replacing or consolidating that table belongs to later Phase 3 cleanup work once descriptor-backed callers fully take over
- Focused Phase 2E verification on 2026-04-25 is green:
  - `bun test src/components/ProviderManager.test.tsx src/commands/provider/provider.test.tsx src/utils/providerValidation.test.ts src/integrations/discoveryService.test.ts src/commands/model/model.test.tsx`
  - `bun test src/utils/providerDiscovery.test.ts src/utils/model/providers.test.ts src/services/api/openaiShim.test.ts src/utils/conversationRecovery.test.ts`
  - `bun test src/utils/status.test.ts src/utils/swarm/teammateModel.test.ts src/utils/model/providers.test.ts src/components/ProviderManager.test.tsx src/commands/provider/provider.test.tsx`
- Filtered `bun run typecheck` for the audited runtime/provider files still reports the same pre-existing baseline noise in `src/services/api/openaiShim.ts` and `src/utils/conversationRecovery.ts`; no new 2E-specific typecheck failures were introduced by this packet.

---

## Phase 2 Merge Checkpoints

- [x] **2A merged** — validation metadata checkpoint landed on `cheeky-cooking-moon`
- [x] **2A.5 merged** — discovery cache service checkpoint landed on `cheeky-cooking-moon`
- [x] **2B merged** — discovery/readiness metadata checkpoint landed on `cheeky-cooking-moon`
- [x] **2C merged** — provider UI metadata checkpoint landed on `cheeky-cooking-moon`
- [x] **2D merged** — runtime provider detection checkpoint landed on `cheeky-cooking-moon`
- [x] **2E complete** — drift audit is green and Phase 3 can begin

---

## Phase 3: Cleanup

**Status**: `IN_PROGRESS`

**Goal**: Remove transitional duplication once descriptor-backed behavior is trusted.

### Phase 3 Exit Criteria

- [ ] Obsolete switch chains are removed
- [ ] Compatibility shims are minimized and clearly named
- [ ] Remaining exceptions are intentional and documented

### Phase 3 Entry Blockers

- [x] Phase 2 is complete on `cheeky-cooking-moon`
- [x] Phase 2E drift audit is recorded in `plan/phase-2e-drift-audit.md`
- [ ] Decide whether repo-wide `bun run typecheck` baseline debt stays accepted during Phase 3 implementation, or whether any cleanup packet should carve off part of that debt explicitly

Notes:
- Phase 3 starts from the completed Phase 2 drift audit, not from the original migration assumptions.
- Phase 3 planning was re-reviewed against `plan/cheeky-cooking-moon.md` on 2026-04-25 20:24 so the tracker sections below mirror the master-plan packet order, dependencies, and cleanup boundaries.
- Active work resumed on 2026-04-25 20:39 with the first `3A` pass focused on removing duplicated provider-label/default branches from metadata-only surfaces before touching any compatibility or env-shaping bridges.
- `src/utils/model/configs.ts` is currently a compatibility bridge for legacy `APIProvider` callers such as teammate fallback; Phase 3 is where we decide whether to keep, rename, or retire that bridge.
- Provider surfaces already identified as transitional or likely Phase 3 cleanup candidates include:
  - legacy `APIProvider` compatibility mapping in `src/utils/model/providers.ts`
  - compatibility tables in `src/utils/model/configs.ts`
  - duplicated provider/env shaping spread across `src/utils/providerProfiles.ts`, `src/utils/providerProfile.ts`, and startup/runtime helpers
  - remaining explicit provider branches recorded in `plan/phase-2e-drift-audit.md`
- Until the repo-wide typecheck-debt decision is explicit, keep each Phase 3 packet scoped tightly and do not treat unrelated baseline `bun run typecheck` noise as proof that the cleanup work itself is blocked.

### Phase 3 Recommended Sequence

- [x] Remove dead metadata switches first
- [x] Consolidate overlapping type/name surfaces second
- [ ] Consolidate env-shaping/runtime bridges third
- [ ] Finish with one more audit and documentation pass

Notes:
- Keep these as separate branch-local checkpoints on `cheeky-cooking-moon`; Phase 3 cleanup should not be bundled into one large mixed packet.
- If a candidate removal or rename depends on proving runtime parity first, defer it to the later packet instead of forcing it into `3A`.

---

## Phase 3A: Dead Switch Removal

**Status**: `COMPLETE`

- [x] Identify every switch made redundant by descriptors
- [x] Remove only the switches proven obsolete by tests
- [x] Keep a short migration note in commit/PR text for anything user-visible

### Current Slice Checklist

- [x] Audit the first metadata-only cleanup slice against `plan/phase-2e-drift-audit.md`
- [x] Remove duplicated OpenAI-compatible status-display branches in `src/utils/status.tsx`
- [x] Add focused regression coverage for the shared status-display path
- [x] Review `/provider` summary helpers for the next safe 3A cleanup slice
- [x] Remove the pure transport-kind label switch in `src/integrations/routeMetadata.ts`
- [x] Remove the pure provider-label switch in `src/components/CostThresholdDialog.tsx`
- [x] Add focused regression coverage for route-metadata and cost-threshold label paths
- [x] Decide which remaining candidates stay in `3A` versus move to `3B` or `3C`

Notes:
- Start from the inventory already captured in `plan/phase-2e-drift-audit.md`.
- Dependency from the master plan is already satisfied here because Phase 2 is complete on `cheeky-cooking-moon`.
- Candidate removals should exclude switches already classified as intentional compatibility bridges, transport executors, or UI state machines.
- Expected early-review candidates include older provider-label/default branches that are now fully descriptor-backed.
- Current slice: collapse duplicated OpenAI-compatible provider display branches in `src/utils/status.tsx` first, then decide whether the same treatment is safe for any `/provider` summary helpers without crossing into env-contract cleanup.
- Completed initial `3A` cleanup slice on 2026-04-25 20:46:
  - collapsed duplicated OpenAI-compatible status-display branches in `src/utils/status.tsx` behind shared provider metadata for `openai`, `codex`, `nvidia-nim`, and `minimax`
  - kept Bedrock, Vertex, Foundry, Gemini, and Mistral handling unchanged because those still rely on distinct env contracts or cloud/runtime details
  - added focused Codex status regression coverage in `src/utils/status.test.ts`
  - focused verification is green:
    - `bun test src/utils/status.test.ts src/utils/swarm/teammateModel.test.ts src/utils/model/providers.test.ts`
    - filtered `bun run typecheck` for `src/utils/status.tsx` and `src/utils/status.test.ts` returned `FILTER_CLEAN`
- Completed follow-up `3A` sweep on 2026-04-25 20:58:
  - reviewed `/provider` summary helpers and kept them out of `3A` because their remaining branches still reflect distinct saved-profile/env contracts rather than dead descriptor metadata
  - replaced the pure transport-kind label switch in `src/integrations/routeMetadata.ts` with shared transport-kind label metadata and added `src/integrations/routeMetadata.test.ts`
  - replaced the pure provider-label switch in `src/components/CostThresholdDialog.tsx` with a shared provider-label map and added `src/components/CostThresholdDialog.test.ts`
  - re-swept the remaining obvious branch sites; the switches left in `discoveryService.ts`, `providerValidation.ts`, `provider.tsx`, and `model/providers.ts` remain classified as runtime executors, compatibility bridges, or env-contract handlers and therefore move to later packets instead of staying in `3A`
  - focused verification is green:
    - `bun test src/integrations/routeMetadata.test.ts src/utils/status.test.ts src/components/CostThresholdDialog.test.ts src/utils/model/providers.test.ts`
    - filtered `bun run typecheck` for the touched `routeMetadata`, `status`, and `CostThresholdDialog` files returned `FILTER_CLEAN`
- `3A` migration note / checkpoint landed on `cheeky-cooking-moon` in commit `df8f232` (`refactor: start phase 3a dead-switch cleanup`), so the remaining `3A` work is closed and the next active packet is `3B`.

---

## Phase 3B: Type and Naming Consolidation

**Status**: `COMPLETE`

- [x] Decide which legacy names remain public API
- [x] Keep compatibility aliases where callers still rely on them
- [x] Rename internal helpers where descriptor terminology is clearer

### Current Slice Checklist

- [x] Keep `APIProvider` as the public compatibility surface for existing callers
- [x] Introduce explicit `legacy` / `compatibility` names for bridge types and tables
- [x] Rename provider-profile compatibility helper names so env-shaping bridges read like bridges
- [x] Verify the naming-only pass does not change provider/profile behavior

Notes:
- This packet is the place to make the long-term naming decision after Phase 2D, but it should stay behavior-light wherever possible.
- This packet should explicitly decide the long-term role of `APIProvider` versus descriptor route ids.
- `src/utils/model/configs.ts` and similar provider-keyed tables should either be renamed as explicit compatibility bridges or moved behind clearer descriptor-era helpers.
- Any consolidation here must preserve the external caller contracts that still intentionally consume legacy provider categories.
- Keep saved-profile formats, env var names, and user-facing route/provider wording stable unless a later packet explicitly migrates them.
- Active work resumed on 2026-04-25 21:11 with a first naming-only pass over `src/utils/model/providers.ts`, `src/utils/model/configs.ts`, `src/utils/model/modelStrings.ts`, `src/utils/model/deprecation.ts`, and `src/utils/providerProfiles.ts`.
- Current target for this pass:
  - keep `APIProvider` as the public compatibility surface for existing callers
  - introduce clearer internal `legacy` / `compatibility` names for bridge types and tables
  - rename provider-profile runtime helper names so env-shaping bridges read like bridges instead of descriptor-native routing
- Completed on 2026-04-25 21:19:
  - kept `APIProvider` as the backward-compatible public name, but introduced `LegacyAPIProvider` in `src/utils/model/providers.ts` so the bridge surface is named explicitly where internal callers want that clarity
  - renamed the provider-keyed compatibility table surface in `src/utils/model/configs.ts` to `LegacyProviderModelConfig` / `LEGACY_PROVIDER_MODEL_CONFIGS`, while preserving `ModelConfig` and `ALL_MODEL_CONFIGS` as compatibility aliases for older imports
  - updated `src/utils/model/modelStrings.ts` and `src/utils/model/deprecation.ts` to use the clearer legacy compatibility names internally
  - renamed `resolveProfileRuntime()` / `ProfileRuntimeMode` to `resolveProfileCompatibility()` / `ProfileCompatibilityMode` in `src/utils/providerProfiles.ts` so the env-shaping bridge reads as compatibility logic rather than descriptor-native routing
  - focused verification is green:
    - `bun test src/utils/model/providers.test.ts src/utils/providerProfiles.test.ts src/utils/swarm/teammateModel.test.ts src/utils/status.test.ts`
    - filtered `bun run typecheck` for the touched provider/config/modelStrings/deprecation/providerProfiles files returned `FILTER_CLEAN`

---

## Phase 3C: Env-Shaping Consolidation

**Status**: `COMPLETE`

- [x] Compare `providerProfiles.ts`, `providerProfile.ts`, and startup env builders
- [x] Centralize the parts that can now be safely descriptor-driven
- [x] Replace eligible `openaiShim.ts` base URL/provider conditionals with descriptor-backed transport config
- [x] Keep `reasoning_content` preservation behavior intact for routes that require it
- [x] Add or retain regression coverage for assistant messages with thinking blocks, no thinking blocks, string content, tool calls, and synthetic interrupt messages
- [x] Preserve special-case behavior where transport contracts still differ

Notes:
- Phase 2D and 2E intentionally left some env shaping in place for compatibility; this is the cleanup packet that can reduce that duplication.
- Dependency from the master plan is already satisfied here because Phase 2 is complete, but this packet should still remain isolated from pure naming cleanup where possible.
- The known intentional exceptions from Phase 2E (`github`, `mistral`, `bedrock`, `vertex`, `foundry`, env-only MiniMax fallback, env-only NVIDIA NIM fallback) must be re-evaluated carefully rather than flattened by default.
- `openaiShim.ts` should only lose branches that are already provably covered by descriptor/runtime metadata.
- Keep the `reasoning_content` regression list above attached to this packet as a hard gate, not as optional follow-up.
- Active work resumed on 2026-04-25 21:08 with the first `3C` packet focused on consolidating shared compatibility env shaping between `providerProfile.ts`, `providerProfiles.ts`, and the eligible `openaiShim.ts` OpenAI-env projection path without flattening the known exception routes.
- Completed on 2026-04-25 21:32 by introducing a shared managed-env clear/apply path in `src/utils/providerProfile.ts`, switching `buildLaunchEnv()` and `applyProviderProfileToProcessEnv()` onto that shared compatibility shaper, and reducing `createOpenAIShimClient()` to the remaining credential aliasing that `resolveProviderRequest()` does not already cover.
- The `3C` packet intentionally preserved the known exception routes instead of flattening them: `github`, `mistral`, `bedrock`, `vertex`, env-only Bankr aliasing, env-only MiniMax fallback detection, and the NVIDIA NIM mode bit now remain explicit where transport/auth contracts still differ.
- Targeted verification is green:
  - `bun test src/utils/providerProfile.test.ts src/utils/providerProfiles.test.ts src/services/api/openaiShim.test.ts`
  - filtered `bun run typecheck` output no longer reports new errors in `src/utils/providerProfile.ts` or `src/utils/providerProfiles.ts`; the remaining hits in `src/services/api/openaiShim.ts` are pre-existing repo baseline noise that was already present before this packet.

---

## Phase 3D: Final Audit and Documentation Pass

**Status**: `READY`

- [ ] Inventory all provider-specific special cases still left in the repo
- [ ] Classify them as intentional, temporary, or missed migration work
- [ ] Update the architecture note with final constraints and known exceptions

Notes:
- This packet should build directly on the earlier `plan/phase-2e-drift-audit.md` inventory rather than restarting the audit from scratch.
- Dependency from the master plan is `3A` through `3C`; do not mark this complete until those packets land or are explicitly waived.
- The expected output is a tighter final exception list plus plan/docs updates that clearly distinguish intentional long-term exceptions from temporary cleanup leftovers.

---

## Phase 3 Merge Checkpoints

- [x] **3A merged** — dead-switch cleanup landed in small safe packets
- [x] **3B merged** — type/naming consolidation landed separately from runtime behavior changes
- [ ] **3C merged** — env-shaping consolidation landed after targeted regression tests
- [ ] **3D complete** — final audit/doc pass is green and Phase 4 can begin

Notes:
- As with the earlier checkpoints, "merged" here means landed on `cheeky-cooking-moon`, not merged out to another branch.

---

## Quick Reference: Files Created in Phase 1

```text
src/integrations/
  descriptors.ts
  define.ts
  registry.ts
  index.ts
  compatibility.ts
  registry.test.ts
  brands/
    claude.ts
    deepseek.ts
    gpt.ts
    kimi.ts
    llama.ts
    qwen.ts
  vendors/
    anthropic.ts
    openai.ts
    (optional) openai.models.ts
    gemini.ts
    moonshot.ts
    deepseek.ts
    (optional) deepseek.models.ts
    minimax.ts
    bankr.ts
    zai.ts (if PR #896)
  gateways/
    ollama.ts
    (optional) ollama.models.ts
    lmstudio.ts
    atomic-chat.ts
    openrouter.ts
    together.ts
    groq.ts
    mistral.ts
    azure-openai.ts
    github.ts
    bedrock.ts
    vertex.ts
    dashscope-cn.ts
    dashscope-intl.ts
    nvidia-nim.ts
    custom.ts
  models/
    claude.ts
    gpt.ts
    kimi.ts
    deepseek.ts
    llama.ts
    qwen.ts
```

---

## How to Update This File

Check boxes as tasks complete. When a whole phase packet (1A–1F, 2A–2E, etc.) is done, update its **Status** and check the corresponding merge checkpoint. When a phase's merge checkpoints are done, update that phase's exit criteria to match the actual branch state.
