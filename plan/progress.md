# OpenClaude Descriptor Migration — Progress Tracker

**Master Plan**: [`plan/cheeky-cooking-moon.md`](./cheeky-cooking-moon.md)
**Current Phase**: Phase 1 — Foundation and Parity
**Next Planned Phase**: Phase 2 — Runtime Metadata Adoption
**Goal**: Establish the descriptor system without regressing current behavior. Get all metadata into one place before deeper runtime migration starts.
**Last Updated**: 2026-04-25 16:49

---

## Phase 1 Exit Criteria

- [ ] Registry exists and loads
- [ ] Every currently supported integration has descriptor coverage
- [ ] Preset defaults and `/usage` can read from descriptors
- [ ] Existing saved profiles still deserialize and activate

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
- After the repo-wide typecheck blocker is resolved or explicitly waived, finish Phase 1 by rerunning `bun run typecheck`, updating the exit criteria, and checking `1F complete`.

---

## Phase 1 Merge Checkpoints

- [ ] **1A merged** — registry skeleton + tests checkpoint landed on `cheeky-cooking-moon`
- [ ] **1B+1C merged** — descriptor inventory + brand/model index checkpoint landed on `cheeky-cooking-moon`
- [x] **1D merged** — config compatibility checkpoint landed on `cheeky-cooking-moon`
- [x] **1E merged** — CLI/usage checkpoint landed on `cheeky-cooking-moon`
- [ ] **1F complete** — all tests green, exit criteria met, ready for Phase 2

---

## Phase 2: Runtime Metadata Adoption

**Status**: `IN_PROGRESS`

**Goal**: Move decision-making logic onto descriptors so runtime surfaces stop duplicating provider rules.

### Phase 2 Exit Criteria

- [ ] Validation, discovery hints, preset metadata, and runtime affordances are descriptor-backed
- [ ] UI and command surfaces read shared metadata instead of bespoke switches

### Phase 2 Entry Blockers

- [ ] Phase 1F is completed, or the repo-wide `tsc --noEmit` baseline is explicitly accepted as pre-existing debt
- [ ] Phase 1 merge checkpoints are confirmed in branch order on `cheeky-cooking-moon`
- [ ] Phase 1 exit criteria are reconciled with current behavior before Phase 2 consumer migrations begin

Notes:
- Once the entry blockers clear, start `2A` and `2A.5` first; they are the planned front door for Phase 2 work.
- `2B` depends on `2A.5`, `2C` depends on `2A.5`, `2D` should coordinate with `2A` and `2B`, and `2E` stays last.
- `2A` was completed on-branch on 2026-04-25 by explicit user direction before the broader entry blockers were formally reconciled; keep that sequencing note visible while the remaining Phase 2 packets stay gated behind stable follow-on prerequisites.

### Phase 2 Recommended Sequence

- [ ] Migrate read-only metadata consumers first
- [ ] Migrate env/routing helpers second
- [ ] Retire duplicated logic only after parity is verified

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
- Current helper behavior: `getCachedModels(routeId, ttlMs)` returns only fresh successful entries, while `recordDiscoveryError()` preserves stale models or stores an error-only entry for later consumers.
- Focused verification on 2026-04-25 is green:
  - `bun test src/integrations/discoveryCache.test.ts`
  - filtered `bun run typecheck` for `src/integrations/discoveryCache*.ts` returned clean output

---

## Phase 2B: Discovery and Readiness Metadata Migration

**Status**: `BLOCKED`

- [ ] Map current readiness flows for Ollama, Atomic Chat, and other local/openai-compatible providers
- [ ] Define which probe behaviors can be declared as metadata
- [ ] Keep actual probe execution in code, but drive probe selection from descriptors
- [ ] Add a model discovery service that can run declarative `catalog.discovery` configs
- [ ] Consume `discoveryCache.ts` in the discovery service
- [ ] Wire `setCachedModels` / `getCachedModels` into declarative `catalog.discovery` execution
- [ ] Implement deterministic hybrid merge behavior where curated descriptor entries override discovered metadata
- [ ] Implement built-in `discovery.kind: 'openai-compatible'` support for standard `/v1/models` discovery
- [ ] Ensure OpenAI-compatible discovery uses the route's base URL and descriptor/profile-resolved headers automatically
- [ ] Reserve custom discovery functions for non-standard response shapes only
- [ ] Verify local provider labels still render correctly
- [ ] Verify readiness messages still render correctly

Notes:
- Unblock after `2A.5` provides the cache service and `2A` clarifies the descriptor-backed metadata boundaries.
- Start with Ollama and Atomic Chat first so local readiness flows stay easy to compare with current behavior.

---

## Phase 2C: Provider UI Metadata Migration

**Status**: `BLOCKED`

- [ ] Replace hardcoded preset labels/defaults with descriptor lookups
- [ ] Drive auth/setup prompts from descriptor metadata
- [ ] Wire custom-header capability flags into the custom-provider flow
- [ ] Make `/model` read active route catalog entries instead of global model availability
- [ ] Call `getCachedModels` before rendering `/model` for dynamic/hybrid routes so cached discovered models appear immediately
- [ ] Call `isCacheStale` to trigger background refresh when picker opens
- [ ] Add `/model refresh` command to force model discovery refresh for the active route
- [ ] Add an in-picker refresh action for model discovery, such as pressing `r`
- [ ] Call `clearDiscoveryCache(routeId)` from `/model refresh` and in-picker refresh handlers
- [ ] Show non-blocking refresh states: loading, success, failure with stale cache, and no changes found
- [ ] Surface `entry.error` in the picker UI when refresh failed but stale data exists
- [ ] Keep any UX-only branching that is truly presentational
- [ ] Verify the `/provider` experience remains understandable after metadata migration

Notes:
- Unblock after `2A.5` and the first round of `2B` discovery/readiness helpers are stable enough for UI consumers.
- Work this packet in two slices: descriptor-backed provider labels/setup first, then `/model` cache/refresh UX second.

---

## Phase 2D: Runtime Provider Detection Alignment

**Status**: `BLOCKED`

- [ ] Define the boundary between `APIProvider` and descriptor ids
- [ ] Decide which legacy runtime provider names stay externally visible
- [ ] Map descriptor-backed state onto `getAPIProvider()` without breaking existing callers
- [ ] Inventory current `openaiShim.ts` provider/base-url conditionals and classify which can become descriptor metadata
- [ ] Preserve DeepSeek/Moonshot `reasoning_content` replay behavior from PR #895 if it has landed
- [ ] If PR #895 has not landed, explicitly test whether the migration still covers its reported DeepSeek thinking-mode edge cases
- [ ] Preserve Z.AI GLM Coding Plan behavior from PR #896 if it has landed
- [ ] Move Z.AI-style `max_tokens`, `store` stripping, thinking request format, and `reasoning_content` gates into descriptor metadata where possible
- [ ] Avoid assuming DeepSeek-like reasoning behavior only applies to direct DeepSeek URLs; gateways may expose models with the same requirement
- [ ] Document exceptions such as `github`, `bedrock`, `vertex`, and `mistral`
- [ ] Verify existing callers still receive expected provider categories

Notes:
- Unblock after `2A` and `2B` establish the descriptor-backed metadata that runtime detection will consume.
- Before starting, check whether PR `#895` or PR `#896` landed so this packet preserves the right transport quirks instead of duplicating stale assumptions.

---

## Phase 2E: Phase-2 Verification and Drift Audit

**Status**: `BLOCKED`

- [ ] Run `/provider` flows for representative providers
- [ ] Verify validation errors still appear at the right times
- [ ] Verify local discovery still works
- [ ] Audit remaining switch statements
- [ ] Document whether each remaining switch is intentional or stale

Notes:
- Unblock only after `2A` through `2D` are complete enough to audit as one behavior slice.
- Treat this packet as the gate before any Phase 3 cleanup work starts.

---

## Phase 2 Merge Checkpoints

- [ ] **2A merged** — validation metadata checkpoint landed on `cheeky-cooking-moon`
- [ ] **2A.5 merged** — discovery cache service checkpoint landed on `cheeky-cooking-moon`
- [ ] **2B merged** — discovery/readiness metadata checkpoint landed on `cheeky-cooking-moon`
- [ ] **2C merged** — provider UI metadata checkpoint landed on `cheeky-cooking-moon`
- [ ] **2D merged** — runtime provider detection checkpoint landed on `cheeky-cooking-moon`
- [ ] **2E complete** — drift audit is green and Phase 3 can begin

---

## Quick Reference: Files Created in Phase 1

```
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
