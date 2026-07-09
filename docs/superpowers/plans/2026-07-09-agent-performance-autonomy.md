# Agent Performance, Autonomy & Knowledge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an autonomy layer that routes by task tier + provider health, captures session knowledge, and maximizes agent experience without rewriting QueryEngine.

**Architecture:** Thin `src/services/autonomy/` controller feeds `resolveAgentProvider` / API client with `RouteDecision`; telemetry + stop-hooks feed memdir and `docs/superpowers/knowledge/`.

**Tech Stack:** TypeScript (Bun), existing settings JSON, Ollama/OpenAI-compatible providers, bun:test, PowerShell launch scripts.

**Spec:** `docs/superpowers/specs/2026-07-09-agent-performance-autonomy-design.md`

---

## File map (create / modify)

| Path | Role |
|------|------|
| `src/services/autonomy/taskSignals.ts` | Feature extraction from prompt/context |
| `src/services/autonomy/complexityClassifier.ts` | Signals → TaskTier |
| `src/services/autonomy/routePolicy.ts` | Tier + settings → RouteDecision |
| `src/services/autonomy/providerHealth.ts` | Health/latency registry |
| `src/services/autonomy/circuitBreakers.ts` | Loop stop rules |
| `src/services/autonomy/telemetry.ts` | JSONL turn events |
| `src/services/autonomy/sessionInsights.ts` | End-of-session bullets |
| `src/services/autonomy/index.ts` | Public API |
| `src/services/autonomy/*.test.ts` | Unit tests |
| `src/services/api/agentRouting.ts` | Integrate autonomy when enabled |
| `src/utils/settings/types.ts` | `autonomy`, `taskRouting`, `fallbackChains` types |
| `src/query/stopHooks.ts` | Session insights hook |
| `start-ollama.ps1` | `smart|fast|code|quality` modes |
| `scripts/provider-launch.ts` / profile scripts | Autonomy env flags |
| `GUIA_USO.md`, `PLAYBOOK.md` | User-facing docs |
| `docs/superpowers/knowledge/*` | Living knowledge |

---

## Phase 0 — Scaffold & baseline

### Task 0.1: Knowledge base bootstrap

**Files:**
- Create: `docs/superpowers/knowledge/README.md`
- Create: `docs/superpowers/knowledge/ROUTING_BASELINE.md`
- Create: `docs/superpowers/knowledge/SESSION_INSIGHTS_TEMPLATE.md`

- [ ] **Step 1: Ensure knowledge README exists** (see companion file in repo)

- [ ] **Step 2: Record baseline models on this machine**

Run:

```powershell
ollama list
Get-Content .\.openclaude-profile.json
if (Test-Path $env:USERPROFILE\.claude\settings.json) { Get-Content $env:USERPROFILE\.claude\settings.json }
```

Fill `ROUTING_BASELINE.md` with installed models and current `agentRouting`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers
git commit -m "docs: add autonomy design, plan, and knowledge scaffold"
```

---

## Phase 1 — Classifier + taskRouting (MVP)

### Task 1.1: Settings types

**Files:**
- Modify: `src/utils/settings/types.ts` (find `agentModels` / `agentRouting` definitions)
- Test: `src/services/autonomy/routePolicy.test.ts` (created later)

- [ ] **Step 1: Locate existing settings types**

```powershell
rg -n "agentRouting|agentModels" src/utils/settings
```

- [ ] **Step 2: Add types** (names must match design doc)

```ts
export type TaskTier = 'trivial' | 'standard' | 'hard' | 'vision'

export type AutonomyMode = 'smart' | 'fast' | 'code' | 'quality' | 'fixed'

export type AutonomySettings = {
  enabled?: boolean
  mode?: AutonomyMode
  autoApplyPolicy?: boolean
  classifier?: 'heuristic' | 'off'
  circuitBreakers?: boolean
  telemetry?: boolean
}

// On SettingsJson:
// autonomy?: AutonomySettings
// taskRouting?: Partial<Record<TaskTier, string>>
// fallbackChains?: Partial<Record<TaskTier | 'default', string[]>>
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/settings/types.ts
git commit -m "feat(settings): add autonomy and taskRouting types"
```

---

### Task 1.2: Task signals + heuristic classifier (TDD)

**Files:**
- Create: `src/services/autonomy/taskSignals.ts`
- Create: `src/services/autonomy/complexityClassifier.ts`
- Create: `src/services/autonomy/complexityClassifier.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from 'bun:test'
import { classifyComplexity } from './complexityClassifier.js'

describe('classifyComplexity', () => {
  test('short greeting is trivial', () => {
    expect(classifyComplexity({ text: 'olá' }).tier).toBe('trivial')
  })

  test('single file fix is standard', () => {
    const r = classifyComplexity({
      text: 'Corrige o bug no arquivo src/foo.ts na função parse',
    })
    expect(r.tier).toBe('standard')
  })

  test('architecture multi-module is hard', () => {
    const r = classifyComplexity({
      text: 'Redesenha a arquitetura de autenticação em vários módulos e propõe migration',
    })
    expect(r.tier).toBe('hard')
  })

  test('image mention is vision', () => {
    const r = classifyComplexity({
      text: 'Analisa este screenshot',
      hasImage: true,
    })
    expect(r.tier).toBe('vision')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test src/services/autonomy/complexityClassifier.test.ts
```

- [ ] **Step 3: Implement signals + classifier**

`taskSignals.ts` — extract:

- `charCount`, `hasImage`, `pathMentions`, `multiFileHints`, `architectureKeywords`, `readOnlyHints`

`complexityClassifier.ts` — rules (order matters):

1. `hasImage` → `vision`
2. architecture / multi-module / "do zero" / security audit keywords → `hard`
3. very short (< 80 chars) + no path → `trivial`
4. else → `standard`

Return `{ tier, signals, reasons: string[] }`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test src/services/autonomy/complexityClassifier.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/autonomy
git commit -m "feat(autonomy): heuristic task complexity classifier"
```

---

### Task 1.3: Route policy (TDD)

**Files:**
- Create: `src/services/autonomy/routePolicy.ts`
- Create: `src/services/autonomy/routePolicy.test.ts`
- Modify: `src/services/api/agentRouting.ts` (or keep wrapper in autonomy/index)

- [ ] **Step 1: Write tests for priority**

```ts
// 1) autonomy disabled → null (caller uses legacy resolveAgentProvider)
// 2) taskRouting.trivial wins for trivial tier when enabled
// 3) mode=quality forces hard model key when configured
// 4) mode=fixed returns null
// 5) reason[] always non-empty when decision non-null
```

- [ ] **Step 2: Implement `resolveTaskRoute(input): RouteDecision | null`**

Inputs: `{ tier, agentName?, subagentType?, settings, userPinnedModel? }`

Logic:

```
if !settings.autonomy?.enabled || mode==='fixed' → null
if userPinnedModel → decision with source 'static'
map tier → taskRouting[tier] || agentRouting fallback || default
apply mode biases:
  fast: downgrade hard→standard if standard model exists (except vision)
  quality: upgrade trivial/standard→hard if hard model exists
  code: prefer models whose name includes coder|code when tied
attach fallbackChains[tier] || fallbackChains.default || []
```

- [ ] **Step 3: Export from `src/services/autonomy/index.ts`**

- [ ] **Step 4: bun test autonomy/**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(autonomy): route policy for task tiers and modes"
```

---

### Task 1.4: Wire into agentRouting

**Files:**
- Modify: `src/services/api/agentRouting.ts`
- Modify: `src/services/api/agentRouting.test.ts`

- [ ] **Step 1: Extend `resolveAgentProvider` signature carefully**

Prefer additive optional args to avoid breaking callers:

```ts
export function resolveAgentProvider(
  name: string | undefined,
  subagentType: string | undefined,
  settings: SettingsJson | null,
  options?: {
    userText?: string
    hasImage?: boolean
    userPinnedModel?: string
  },
): ProviderOverride | null
```

When autonomy enabled and classifier not `off`:

1. `classifyComplexity({ text: options.userText ?? '', hasImage })`
2. `resolveTaskRoute(...)`
3. If decision → map to `ProviderOverride` via `agentModels[decision.model]`
4. Else legacy routing

- [ ] **Step 2: Find all call sites**

```bash
rg -n "resolveAgentProvider\(" src
```

Pass `userText` where message content is available; otherwise classifier falls back to `standard` via empty text → keep agentRouting behavior.

- [ ] **Step 3: Tests for autonomy on/off**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(autonomy): integrate task routing into resolveAgentProvider"
```

---

### Task 1.5: Launch presets

**Files:**
- Modify: `start-ollama.ps1`
- Modify: `GUIA_USO.md`
- Modify: `PLAYBOOK.md`
- Optional: `package.json` scripts `dev:smart`, `dev:fast`, `dev:code`, `dev:quality`

- [ ] **Step 1: Add `-AutonomyMode smart|fast|code|quality|fixed`**

On launch, merge into user settings or set env:

```
OPENCLAUDE_AUTONOMY=1
OPENCLAUDE_AUTONOMY_MODE=smart
```

Read these env vars in settings load or autonomy index as override.

- [ ] **Step 2: Document in GUIA_USO (PT)**

Table of modes + example `taskRouting` for this machine.

- [ ] **Step 3: Manual smoke**

```powershell
.\start-ollama.ps1 -Mode ollama -AutonomyMode smart
# inside: ask "oi" → expect small model if configured
# ask architecture redesign → expect hard model
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(launch): autonomy presets smart/fast/code/quality"
```

---

## Phase 2 — Health + fallback

### Task 2.1: Provider health registry

**Files:**
- Create: `src/services/autonomy/providerHealth.ts`
- Create: `src/services/autonomy/providerHealth.test.ts`

- [ ] Port scoring from `python/smart_router.py`:
  - `latency_ms`, `avg_latency_ms` EMA α=0.3
  - `error_rate`, `healthy`
  - `score(strategy: 'latency'|'cost'|'balanced')`
- [ ] `pingProvider(baseURL)` → GET `/models` or `/api/tags` with 5s timeout
- [ ] `recordSuccess` / `recordFailure` after API calls
- [ ] Tests with mock timers / fake fetch

- [ ] Commit: `feat(autonomy): provider health registry with EMA latency`

### Task 2.2: Fallback on API failure

**Files:**
- Modify: API client retry path (`src/services/api/withRetry.ts` and/or openai shim client)
- Modify: `routePolicy` to expose `fallbackChain`

- [ ] On retriable provider error, pick next model in chain with healthy score
- [ ] Log `[autonomy] fallback from A to B reason=...`
- [ ] Test with simulated 503 then success on second provider
- [ ] Commit: `feat(autonomy): automatic provider/model fallback chain`

### Task 2.3: doctor:autonomy

**Files:**
- Create or extend scripts doctor report
- Document in PLAYBOOK

- [ ] JSON: health table, last N route decisions (from telemetry if present)
- [ ] Commit: `feat(doctor): autonomy health and route report`

---

## Phase 3 — Circuit breakers + effort

### Task 3.1: Circuit breakers

**Files:**
- Create: `src/services/autonomy/circuitBreakers.ts`
- Wire near tool orchestration or query loop

Rules:

1. Same tool name + normalized error ≥ 3 in one turn → yield stop message
2. ≥ 2 edit tools with no filesystem change → stop
3. Optional max tools per turn from env `OPENCLAUDE_MAX_TOOLS_PER_TURN`

- [ ] Tests for each rule
- [ ] Commit: `feat(autonomy): circuit breakers for agent loops`

### Task 3.2: Effort mapping

- Map tier → default effort when model supports effort
- `trivial→low`, `standard→medium`, `hard/vision→high`
- Commit: `feat(autonomy): map task tier to effort levels`

---

## Phase 4 — Knowledge loop

### Task 4.1: Turn telemetry

**Files:**
- Create: `src/services/autonomy/telemetry.ts`

- [ ] Append JSONL to `~/.openclaude/telemetry/turns.jsonl`
- [ ] Fields: ts, tier, model, reasons, ttftMs, toolMs, success, tokensIn, tokensOut, sessionId
- [ ] Gate on `autonomy.telemetry !== false`
- [ ] Never upload; document privacy in SECURITY/GUIA
- [ ] Commit: `feat(knowledge): local turn telemetry jsonl`

### Task 4.2: Session insights

**Files:**
- Create: `src/services/autonomy/sessionInsights.ts`
- Modify: `src/query/stopHooks.ts`

- [ ] After successful stop, summarize last session routes + failures into short markdown
- [ ] Write to `~/.openclaude/insights/<sessionId>.md`
- [ ] Optionally surface system message: "3 insights ready — /promote-knowledge"
- [ ] Commit: `feat(knowledge): session insight extraction on stop`

### Task 4.3: Promote knowledge command

**Files:**
- Create: `src/commands/promote-knowledge/` (follow existing command pattern under `src/commands/`)

- [ ] Copy/select insights into `docs/superpowers/knowledge/YYYY-MM-DD-<slug>.md`
- [ ] Update `docs/superpowers/knowledge/README.md` index table
- [ ] Commit: `feat(knowledge): /promote-knowledge command`

### Task 4.4: First real knowledge entries (human + agent)

- [ ] After 3 real coding sessions, promote at least one routing insight and one project pattern
- [ ] Link from PLAYBOOK.md “Learned” section

---

## Phase 5 — Context performance (after metrics)

### Task 5.1: Observation masking design spike

- Measure average tool result tokens on 5 sessions
- Prototype truncate of grep/bash output with “full available on demand”
- Flag `autonomy.maskToolResults`

### Task 5.2: Delta file context

- When file already in `FileStateCache`, send diff or “unchanged since line X” hint instead of full re-read payload when safe

---

## Phase 6 — Advanced (optional backlog)

- Draft model (local 7B) plans tools; hard model executes writes only
- Tool top-K injection / ToolSearch default
- GPU-aware coordinator fan-out limit
- Enable paths related to microcompact if provider supports cache edits

---

## Verification checklist (every phase)

```powershell
bun test src/services/autonomy
bun test src/services/api/agentRouting.test.ts
bun run doctor:runtime
# manual: smart mode trivial vs hard prompts
```

When claiming phase complete: paste command outputs (verification-before-completion).

---

## Execution order (strict)

0.1 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 2.* → 3.* → 4.* → 5.* → 6.*

Do not start Phase 5 until Phase 1 presets are in daily use ≥2 days or metrics exist.

---

## Self-review (plan vs spec)

| Spec section | Tasks |
|--------------|-------|
| Autonomy Controller modules | 1.2–1.4, 2.1, 3.1, 4.1 |
| RouteDecision contract | 1.3 |
| Default policy / presets | 1.5, settings types |
| Knowledge loop | 4.1–4.4 |
| Circuit breakers | 3.1 |
| Health + fallback | 2.1–2.2 |
| Observability | 2.3, `/route` can be part of 1.5 or 2.3 |
| PR plan alignment | Phases match PR0–PR8 |

No TBD placeholders in Phase 0–4 task steps.
