# 2026-07-09 — Stop line: test Phases 1–5

**Development pause.** Core autonomy + Ollama is ready for interactive validation.

## What to test

```powershell
cd E:\Agente_OpenClaude
bun run doctor:autonomy:probe
.\start-ollama.ps1
```

Inside the app:

| Prompt type | Example | Expected route |
|-------------|---------|----------------|
| Trivial | `oi` | `qwen2.5:7b` |
| Standard | explain/fix a file under `src/` | `qwen2.5:14b` |
| Hard | multi-module architecture redesign | `qwen3-vl:235b-cloud` |
| Visibility | `/route` | enabled + taskRouting + recent events |

Also: large Bash/Grep should get **preview + disk path** (Phase 5), not full dump.

## Shipped on branch `feature/autonomy-phase1`

- Phases **1–5** (routing, health/fallback, breakers, knowledge, context budget)
- Ollama-first policy (`bun run autonomy:ollama`)
- PR: https://github.com/Gitlawb/openclaude/pull/1921

## Do not do now

- Implement Phase 6 without smoke of 1–5
- Pile more features onto the open PR without review feedback
- Change model defaults without real telemetry

## Phase 6 (later)

Spec only: [`../specs/2026-07-09-phase6-hybrid-local-intelligence.md`](../specs/2026-07-09-phase6-hybrid-local-intelligence.md)

Theme: **Hybrid Local Intelligence** (draft/executor, tool top-K, local RAG, GPU-aware coordinator).  
**Not implemented.**
