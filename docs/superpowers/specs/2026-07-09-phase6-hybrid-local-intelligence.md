# Phase 6 — Hybrid Local Intelligence (design only)

**Date:** 2026-07-09  
**Status:** Documented — **not implemented**  
**Depends on:** Phases 1–5 shipped on `feature/autonomy-phase1` (PR #1921)  
**Audience:** Maintainers and operators testing current autonomy + Ollama

---

## 1. Purpose

Phases 1–5 make OpenClaude **route well, fail over, stop bad loops, learn locally, and protect context**.

Phase 6 is the **product differentiator** layer: use **local Ollama models for most of the work** and reserve strong models for what actually needs them — with measurable savings and privacy-first design.

**One-line product story:**

> Hybrid Local Intelligence — the strong brain only enters when needed; the rest is local, fast, and private.

---

## 2. What is already done (do not re-build)

| Phase | Capability |
|-------|------------|
| 1 | Task tiers + `taskRouting` + presets (`smart`/`fast`/`code`/`quality`/`fixed`) |
| 2 | Provider health + fallback chains + `doctor:autonomy` |
| 3 | Circuit breakers (`runTools` + `StreamingToolExecutor`) |
| 4 | Telemetry, session insights, `/route`, main-thread routing |
| 5 | Tool-result masking / tighter budgets when autonomy is on |
| Ops | Ollama-first fleet via `bun run autonomy:ollama` |

**File read dedup** (`file_unchanged`) already exists — treat as Phase 5 adjacent, not Phase 6 work.

---

## 3. Phase 6 scope (five blocks)

### 3.1 Block A — Draft / Executor (two-model pipeline) — **P0/P1**

**Problem:** One hard model does explore + plan + edit; slow and context-heavy.

**Design:**

1. **Draft** (local 7b/14b): plan bullets, candidate files, hypotheses. **No** Write/Edit/destructive Bash.
2. **Executor** (hard tier model): validate plan, apply edits, run risky tools.

**Contracts (proposed):**

```ts
type DraftPlan = {
  goal: string
  steps: string[]
  candidatePaths: string[]
  risks: string[]
  suggestedTools: string[]
}
```

**Success metrics:**

- Wall-clock on mid coding tasks ↓ 20–40% vs always-hard
- Patch quality ≈ quality mode on a fixed task set
- Telemetry: `% turns where draft avoided a hard call`

**Risks:** Bad draft increases executor work — require JSON/schema plan and “proposal not truth” framing.

---

### 3.2 Block B — Tool top-K selection — **P0**

**Problem:** Dumping many tool schemas raises TTFT and confuses small models (worse with MCP).

**Design:**

1. Intent/tier → select **top 6–12 tools**
2. Remaining tools via ToolSearch / on-demand catalog
3. Hard/vision may keep fuller tool sets; trivial/standard stay lean

**Config (proposed):**

```json
{
  "autonomy": {
    "toolBudget": {
      "trivial": 6,
      "standard": 10,
      "hard": 20,
      "vision": 12
    }
  }
}
```

**Success metrics:**

- Tool-schema tokens/turn ↓ ≥ 50% on standard turns
- Wrong-tool rate does not increase

**Differentiator:** Multi-provider + MCP-aware tool router with `/route` visibility (“tools injected: …”).

---

### 3.3 Block C — Local project RAG / SemanticSearch — **P1**

**Problem:** Blind Grep/Glob on large repos is slow and noisy.

**Design:**

- Local embeddings (Ollama or similar) under `~/.openclaude/index/<project-hash>/`
- Incremental index (mtime/git)
- Tool `SemanticSearch` **or** pre-hints — Grep/Read still verify
- No phone-home

**Success metrics:**

- Fewer Reads / fewer tokens on “where is X implemented?”
- Warm incremental rebuild &lt; 30s on medium repos

**Risks:** Index maintenance; semantic false positives — always confirm with tools.

---

### 3.4 Block D — GPU-aware coordinator DAG — **P2**

**Problem:** Multi-agent without hardware awareness thrash Ollama (model swap).

**Design:**

- Fan-out explore with small models; reduce with hard model
- Queue: prefer one heavy model loaded at a time
- Keep-alive pins per role

**Success metrics:**

- Parallel explores without constant 235b load/unload
- “Model thrash avoided” counter in telemetry

**Note:** Coordinator mode is partially feature-gated in tree; Phase 6 must respect open-build constraints.

---

### 3.5 Block E — Speculative prefetch — **P2**

**Problem:** Perceived latency while user types / model thinks.

**Design:**

- Prefetch Glob/Grep/Read (read-only only)
- Optional background draft plan on 7b
- Cancel on interrupt; do not pollute transcript until accepted

**Success metrics:**

- Perceived TTFT ↓ without increasing destructive I/O

---

## 4. Recommended product packaging

### MVP Phase 6 (one cohesive release)

1. **Tool top-K** (Block B)  
2. **Draft/Executor** for `standard` + `hard` (Block A)  
3. **`/route` extensions:** draft model, tools injected, tokens saved  

### Phase 6.1 (follow-up)

4. Local **SemanticSearch** (Block C)  
5. GPU-aware queue (Block D)  
6. Prefetch polish (Block E)  

### Explicit non-goals

- Model fine-tuning  
- Speculative decoding inside Ollama/vLLM  
- Unattended 24/7 agents without safety gates  
- Massive multi-agent on a single consumer GPU  
- Replacing Grep entirely with RAG  

---

## 5. Example end-user flow (MVP)

**User:** “Corrige o bug de auth no login”

1. Classifier → `standard`  
2. Tool top-K → Read, Grep, Edit, Bash (not full MCP dump)  
3. Draft 14b → plan + candidate paths  
4. Executor (14b or hard by policy) → edits  
5. Telemetry → draft avoided N hard calls; tools 40→8; context −X tokens  
6. `/route` shows the full decision trail  

---

## 6. Metrics dashboard (required for Phase 6 to count as a differentiator)

| Metric | Source | Target |
|--------|--------|--------|
| TTFT p50 | telemetry | ↓ 25% vs always-hard baseline |
| Tokens in/out per coding task | telemetry | ↓ 20% |
| % turns fully local (7b/14b) | telemetry | ↑ without quality drop |
| Tool schema tokens/turn | telemetry | ↓ 50% with top-K |
| Model thrash (optional) | Ollama logs | ↓ |

Without metrics, Phase 6 is feature theater.

---

## 7. Implementation order (when resuming)

1. Spec + settings schema for `toolBudget` and draft/executor flags  
2. Tool top-K injection path (system/tools assembly)  
3. Draft forked agent (read-only tools) → inject plan into executor turn  
4. `/route` + telemetry fields  
5. Evaluation harness (fixed task set on this repo)  
6. Only then RAG / GPU queue  

**Gate:** Do not start Phase 6 implementation until Phases 1–5 are validated in interactive smoke and (ideally) PR #1921 review feedback is addressed.

---

## 8. Testing checklist (when implementing)

- [ ] Autonomy off → no draft, no tool budget change  
- [ ] Trivial turn → no draft stage  
- [ ] Standard → draft runs, executor never sees full MCP dump  
- [ ] Draft cannot Write/Edit  
- [ ] Circuit breakers still trip under repeated tool errors  
- [ ] Masking (Phase 5) still persists huge Bash output  
- [ ] Unit tests for tool ranking + draft schema validation  

---

## 9. Related docs

| Doc | Role |
|-----|------|
| `docs/superpowers/specs/2026-07-09-agent-performance-autonomy-design.md` | Program design (Phases 0–6 overview) |
| `docs/superpowers/plans/2026-07-09-agent-performance-autonomy.md` | Implementation plan Phases 0–5 |
| `docs/superpowers/knowledge/2026-07-09-phase5-context-budget.md` | Phase 5 shipped notes |
| `docs/superpowers/knowledge/2026-07-09-ollama-first-fleet.md` | Ollama fleet policy |
| `GUIA_USO.md` | Operator guide (Ollama + autonomy) |

---

## 10. Stop line (current session)

**Documented only.** No Phase 6 code in this change set.

Operators should test Phases 1–5 now:

```powershell
cd E:\Agente_OpenClaude
bun run build          # if needed
bun run doctor:autonomy:probe
.\start-ollama.ps1
# /route  +  trivial / standard / hard prompts
```

PR: https://github.com/Gitlawb/openclaude/pull/1921
