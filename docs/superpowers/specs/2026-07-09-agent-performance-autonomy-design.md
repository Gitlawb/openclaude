# Design: Agent Performance, Autonomy & Knowledge Loop

**Date:** 2026-07-09  
**Status:** Proposed — awaiting approval to implement  
**Scope:** OpenClaude local/hybrid agent stack (CLI + providers + Ollama/OpenRouter/OpenAI)

---

## 1. Problem

OpenClaude already has a strong agent core (tool loop, streaming parallel tools, agentRouting, compact, speculation, memories). In practice:

1. **Routing is static** — agent type → model; not task complexity, latency, or health.
2. **Heavy models are overused** — e.g. VL 235B as default for Explore/Plan/default.
3. **Smart router exists in Python** but is not on the main TypeScript request path.
4. **Knowledge is partial** — extractMemories / autoDream / memdir exist, but there is no closed loop that turns session outcomes into *routing policy*, *presets*, and *project playbook knowledge*.
5. **Autonomy is manual** — the user must pick modes, models, and recover from provider failure.

We need a system that **chooses well by default**, **learns from runs**, and **surfaces knowledge** so the next session is faster and better.

---

## 2. Goals

| Goal | Success metric |
|------|----------------|
| **Latency** | P50 wall-clock for trivial turns down ≥30% vs always-heavy model |
| **Cost / tokens** | Tokens per successful coding task down ≥20% on mixed workloads |
| **Reliability** | Auto-fallback on provider failure; zero “stuck dead” when Ollama cloud blips |
| **Autonomy** | Zero-config “smart” profile works out of the box |
| **Knowledge** | Durable learnings written after sessions; retrievable next session |
| **Observability** | Every route decision is explainable (`why this model?`) |

### Non-goals (this program)

- Replacing the QueryEngine / tool loop with a new agent framework
- Training or fine-tuning models
- Implementing speculative decoding inside the inference engine (Ollama/vLLM concern)
- Massive multi-agent fan-out on a single consumer GPU

---

## 3. Design principles

1. **Policy over hardcoding** — decisions come from scored rules + live signals, not fixed if/else for each model name.
2. **Cheap first, escalate when needed** — small/local models for triage; large models for hard work.
3. **Stable prefixes, dynamic suffixes** — protect prompt-cache friendliness when providers support it.
4. **Knowledge is a first-class product** — every autonomous improvement writes evidence (metrics + short rationale).
5. **Feature flags + graceful degrade** — new autonomy can be off; legacy fixed profile still works.
6. **Local-first hybrid** — Ollama preferred when healthy and capable; cloud when quality or availability demands it.

---

## 4. Approaches considered

### A. Config-only presets (minimal)

Ship `fast` / `code` / `quality` profiles and better default `agentRouting`.  
**Pros:** Fast to ship. **Cons:** No learning, no health fallback, no task awareness.

### B. Full multi-agent orchestrator rewrite

New planner/executor framework.  
**Pros:** Clean slate. **Cons:** Duplicates QueryEngine; high risk; low reuse of existing compact/tools/memories.

### C. Autonomy layer on existing stack (**recommended**)

Add a thin **Autonomy Controller** in the TS request path:

- Task classifier (heuristic + optional mini-model)
- Provider health + latency scores (port of SmartRouter ideas)
- Policy → model/provider/effort
- Telemetry → knowledge store → policy updates (human-reviewed or auto within bounds)
- Session end → extract memories + routing insights

**Pros:** Reuses 90% of code; incremental PRs; aligns with open build. **Cons:** Touches API client and settings carefully.

**Decision:** Approach C.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / REPL / SDK                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ QueryEngine / query loop                                         │
│  tools · compact · token budget · effort                         │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────┐
│ Autonomy Controller       │   │ Knowledge Loop                  │
│  - TaskSignals            │   │  - TurnTelemetry                │
│  - ComplexityClassifier   │   │  - SessionInsightExtractor      │
│  - ProviderHealthRegistry │   │  - PolicyProposals              │
│  - RoutePolicy            │   │  - memdir + project playbook    │
│  - CircuitBreakers        │   │  - knowledge/*.md (repo)        │
└─────────────┬─────────────┘   └────────────────▲────────────────┘
              │                                  │
              ▼                                  │
┌───────────────────────────┐                    │
│ resolveAgentProvider++    │── ProviderOverride ┤
│ + task tier + health      │                    │
└─────────────┬─────────────┘                    │
              ▼                                  │
┌───────────────────────────┐   metrics ─────────┘
│ OpenAI-compat / Ollama /  │
│ OpenRouter / Gemini / …   │
└───────────────────────────┘
```

### 5.1 Autonomy Controller (new core module)

**Location (proposed):** `src/services/autonomy/`

| Module | Responsibility |
|--------|----------------|
| `taskSignals.ts` | Extract features from user message + context (length, keywords, open files, prior tool failures) |
| `complexityClassifier.ts` | Map signals → `trivial` \| `standard` \| `hard` \| `vision` (rules first; optional LLM later) |
| `providerHealth.ts` | Ping/EMA latency/error rate (TS port of `python/smart_router.py` scoring) |
| `routePolicy.ts` | Given tier + agent type + health + settings → `ProviderOverride` + effort hint |
| `circuitBreakers.ts` | Stop loops: repeated identical tool errors, no-op edit streaks, wall-clock |
| `telemetry.ts` | Structured per-turn events for learning |
| `index.ts` | Public API: `resolveAutonomousRoute(ctx) → RouteDecision` |

### 5.2 Route decision contract

```ts
export type TaskTier = 'trivial' | 'standard' | 'hard' | 'vision'

export type RouteDecision = {
  model: string
  baseURL: string
  apiKey: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  tier: TaskTier
  reason: string[]          // human-readable: why this route
  fallbackChain: string[]   // model keys to try on failure
  source: 'static' | 'policy' | 'health-override' | 'fallback'
}
```

**Priority (highest wins first match):**

1. Explicit user model pin (env / `/model` / CLI flag)
2. Health-override (preferred model unhealthy → next in chain)
3. Task-tier policy (new)
4. Existing `agentRouting` by name / subagentType / default
5. Global profile model

### 5.3 Default policy (starter, tunable via settings)

| Tier | Default intent | Example binding (user-adjustable) |
|------|----------------|-----------------------------------|
| `trivial` | format, short Q, single-file read | local `qwen2.5-coder:7b` or mini cloud |
| `standard` | normal coding, multi-step tools | mid local or mid cloud |
| `hard` | architecture, multi-file, debug hard | large cloud / 235B cloud |
| `vision` | images / screenshots | VL model only |

Agent types still bias tier:

- `Explore` → prefer fast/standard unless hard signals
- `Plan` → standard/hard
- `general-purpose` → classified from message

### 5.4 Knowledge Loop

Three layers of knowledge (complementary, not competing):

| Layer | Store | Writer | Reader |
|-------|-------|--------|--------|
| **Session memories** | `~/.claude/projects/.../memory/` (existing memdir) | extractMemories / autoDream | next prompts |
| **Route telemetry** | `~/.openclaude/telemetry/turns.jsonl` | Autonomy telemetry | offline analysis / auto-tune |
| **Project knowledge** | `docs/superpowers/knowledge/` + optional `PLAYBOOK` sections | human + agent after validated wins | agents via CLAUDE.md / playbook include |

**Autonomous knowledge capture pipeline:**

1. **During turn:** log `RouteDecision`, TTFT, tool times, success/fail, tokens.
2. **End of session (stop hooks):** 
   - existing extractMemories
   - new: `SessionInsightExtractor` produces 3–7 bullets: what worked, what failed, preferred route for this repo
3. **Promotion gate:** insights that repeat ≥N times or pass user `/promote-knowledge` are written into project knowledge files.
4. **Policy proposals:** if `trivial` tasks succeed on small model with high rate, propose lowering default for that agent type (never silent global flip without flag `autonomy.autoApplyPolicy`).

### 5.5 Launch presets (actionable UX)

Extend `start-ollama.ps1` / `profile:*` / package scripts:

| Preset | Behavior |
|--------|----------|
| `smart` (**default recommended**) | Autonomy Controller ON; health; tier routing |
| `fast` | Bias trivial/standard → small models; hard still escalates |
| `code` | Coder-oriented mid models; hard → large |
| `quality` | Always large (current feel) |
| `fixed` | Disable autonomy; pure static profile (compat) |

### 5.6 Circuit breakers (autonomy safety)

- Same tool + same error ≥ 3 → stop and ask / summarize
- ≥ 2 consecutive “edit” turns with zero file change → stop
- Per-subagent tool budget (config)
- Provider error → walk `fallbackChain` once per turn

### 5.7 Observability UX

- Status line or `/route` slash: last decision + reasons
- `doctor:autonomy` JSON report: health scores, last 20 routes, knowledge pending promotions
- Debug log lines: `[autonomy] tier=standard model=... reason=...`

---

## 6. Settings schema (extension)

Extend `~/.claude/settings.json` (and document in GUIA_USO / advanced-setup):

```json
{
  "autonomy": {
    "enabled": true,
    "mode": "smart",
    "autoApplyPolicy": false,
    "classifier": "heuristic",
    "circuitBreakers": true,
    "telemetry": true
  },
  "agentModels": { "...": { "base_url": "...", "api_key": "..." } },
  "agentRouting": {
    "Explore": "…",
    "Plan": "…",
    "default": "…"
  },
  "taskRouting": {
    "trivial": "qwen2.5-coder:7b",
    "standard": "qwen2.5:14b",
    "hard": "qwen3-vl:235b-cloud",
    "vision": "qwen3-vl:235b-cloud"
  },
  "fallbackChains": {
    "hard": ["qwen3-vl:235b-cloud", "gpt-4o", "deepseek-chat"]
  }
}
```

Backward compatible: if `autonomy.enabled` is false/missing, only existing `agentRouting` applies.

---

## 7. Integration points (existing code)

| Existing | Change |
|----------|--------|
| `src/services/api/agentRouting.ts` | Call into autonomy or become thin wrapper |
| API client path that applies `ProviderOverride` | Accept fallback chain + effort |
| `src/query/stopHooks.ts` | Hook SessionInsightExtractor |
| `src/services/extractMemories/*` | Keep; chain after insights |
| `src/services/compact/*` | Unchanged initially; later observation masking |
| `python/smart_router.py` | Source of scoring algorithm; TS port is source of truth for CLI |
| `start-ollama.ps1`, `scripts/provider-*.ts` | Presets `smart/fast/code/quality` |
| `GUIA_USO.md`, `PLAYBOOK.md` | Document autonomy + knowledge |
| `docs/superpowers/knowledge/` | Living knowledge base |

---

## 8. Phased delivery (program map)

### Phase 0 — Knowledge scaffold & baseline metrics (this PR track)
- Docs structure, baseline measurement checklist, default policy proposal for current hardware

### Phase 1 — Task routing + presets (**MVP autonomy**)
- Heuristic classifier, `taskRouting`, presets, `/route` debug, tests

### Phase 2 — Provider health + fallback
- TS health registry, fallback chain on API errors, doctor report

### Phase 3 — Circuit breakers + effort coupling
- Stop useless loops; map tier → default effort

### Phase 4 — Knowledge loop
- Turn telemetry JSONL, session insights, promote-to-knowledge workflow

### Phase 5 — Context performance
- Observation masking, delta file context, evaluate enabling microcompact paths for open build

### Phase 6 — Advanced (optional)
- Draft/executor two-model speculation, tool top-K selection, RAG index, coordinator DAG with GPU-aware limits

---

## 9. Testing strategy

- **Unit:** classifier fixtures (PT/EN prompts), route priority chain, health scoring, fallback
- **Integration:** mock providers (fast fail / slow / healthy), ensure override applied
- **Regression:** `agentRouting` tests remain green when autonomy off
- **Manual:** PLAYBOOK scenarios on Windows + Ollama

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Wrong tier → quality drop | Easy escalate; user pin; log reasons; `quality` preset |
| Health ping noise | EMA + only mark unhealthy after consecutive failures |
| Telemetry privacy | Local-only JSONL; never phone home; respect existing no-telemetry posture |
| Prompt cache bust from dynamic routing | Prefer changing only model body fields that providers allow; keep system prefix stable |
| Scope creep | Hard phase gates; Phases 5–6 only after 1–4 metrics |

---

## 11. Key Decisions

1. **Autonomy as a layer, not a rewrite** — maximizes reuse of QueryEngine/tools/memories.
2. **Heuristic classifier first** — deterministic, free, testable; LLM classifier is Phase 6 optional.
3. **`autoApplyPolicy` default false** — proposals only until trust is earned; autonomy without silent config mutation.
4. **TS SmartRouter port** — CLI path must not depend on Python process for routing.
5. **Knowledge in three layers** — session memdir + local telemetry + repo knowledge docs.
6. **`smart` becomes recommended default** — `fixed` preserves backward compatibility.

---

## 12. Open Questions (for user)

1. **Default mode after ship:** `smart` as default, or opt-in while validating?
2. **Telemetry retention:** 7 / 30 / unlimited local days?
3. **Language of knowledge files:** PT-BR, EN, or bilingual?
4. **Phase 1 model map:** confirm local IDs available on this machine (7b/14b/235b-cloud).

---

## 13. PR Plan

| PR | Title | Depends | Deliverable |
|----|-------|---------|-------------|
| **PR0** | docs: autonomy design + knowledge scaffold | — | specs, plans, knowledge README, baseline |
| **PR1** | feat(autonomy): task tier classifier + taskRouting | PR0 | `src/services/autonomy/*` heuristic, settings types, unit tests |
| **PR2** | feat(autonomy): wire route into agentRouting + presets | PR1 | resolve path, start-ollama/profile presets, GUIA |
| **PR3** | feat(autonomy): provider health + fallback chains | PR2 | health registry, API retry route, doctor |
| **PR4** | feat(autonomy): circuit breakers + effort mapping | PR3 | safer loops |
| **PR5** | feat(knowledge): turn telemetry + session insights | PR2 | JSONL + stop-hook insights |
| **PR6** | feat(knowledge): promote-knowledge + playbook sync | PR5 | durable project learning |
| **PR7** | feat(context): observation masking / delta context | PR4 | token reduction |
| **PR8** | feat(advanced): draft model + tool search (optional) | PR7 | research-grade wins |

Each PR must: tests green, docs updated, `autonomy.enabled=false` path unchanged.

---

## 14. Definition of Done (program)

- [ ] `smart` profile runs without manual model micromanagement
- [ ] Trivial tasks use small model by default when available
- [ ] Unhealthy provider falls back without user intervention
- [ ] Session produces optional insights; promote path documented
- [ ] `/route` or doctor explains last decisions
- [ ] Knowledge folder has first real project learnings after 1 week of use
- [ ] PLAYBOOK + GUIA document the system in PT for this workspace
