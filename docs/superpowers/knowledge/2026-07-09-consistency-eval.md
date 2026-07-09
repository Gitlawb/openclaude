# 2026-07-09 — Consistency & quality evaluation (Phases 1–4)

## Test evidence

| Suite | Result |
|-------|--------|
| `bun test src/services/autonomy` | **51 pass / 0 fail** |
| Consistency contracts (`consistency.integration.test.ts`) | **10/10 pass** |
| `agentRouting.test.ts` | **18 pass** (included above path) |
| `doctor:autonomy` | Runs (settings read + optional probe) |

### Contracts verified

1. Autonomy off → legacy `agentRouting` unchanged  
2. Trivial never picks hard model in `smart`  
3. Architecture → hard + effort high  
4. Image → vision beats hard keywords  
5. Unhealthy primary replaced before call  
6. 503 advances fallback with provenance  
7. Circuit breaker stops 3× same tool error  
8. Classifier deterministic  
9. `quality` upgrades trivial → hard  
10. `fast` downgrades hard → standard  

## Gap closed this session

| Gap | Fix |
|-----|-----|
| Autonomy only on subagents | Main thread `REPL.getToolUseContext` now sets `providerOverride` + model |
| No operator visibility | `/route` command + system insight messages |
| No local learning | Telemetry JSONL + session insights on stopHooks |
| Shared extraction logic | `resolveForMessages` shared main + AgentTool |

## Remaining (professional polish backlog)

| Item | Priority | Status |
|------|----------|--------|
| Wire circuit breakers into `StreamingToolExecutor` | High | **Done** (circuitToolBridge) |
| Apply `effort` from route (API path, no AppState thrash) | Medium | **Done** (query.ts) |
| Ollama-first settings | Ops | **Done** |
| `bun run build` smoke | Ops | **Done** (0.1.7) |
| Virtual list / FPS extras | Low | Optional |
| Codex API tests 3 fail pre-existing | Low | Unrelated |
| PR / merge to main | Ops | Pending user |
| Phases 5–6 (context mask, draft model, RAG) | Optional | Not started |

## Performance notes (render / runtime)

- Route logging uses `logForDebugging` — no extra React state → no Ink re-render storm  
- Telemetry is async appendFile — off critical path  
- Insights fire-and-forget after turn — no TTFT impact  
- Health registry in-memory — O(1) select  
- Classifier pure regex — sub-ms  

## Quality bar for “app profissional”

Met: deterministic policy, failover provenance, opt-out legacy path, local-only telemetry, operator command `/route`.  
Pending ops: enable settings on machine; rebuild CLI (`bun run build`) before daily use.
