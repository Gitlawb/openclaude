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

| Item | Priority |
|------|----------|
| Wire circuit breakers into `StreamingToolExecutor` (not only `runTools`) | High |
| Apply `effort` from route decision to AppState when model supports it | Medium |
| Virtual list / FPS: avoid status re-render thrash (route log is debug-only) | Medium |
| Codex API tests 3 fail pre-existing (unrelated) | Low |
| User settings still lack `taskRouting` until configured | **Ops** |

## Performance notes (render / runtime)

- Route logging uses `logForDebugging` — no extra React state → no Ink re-render storm  
- Telemetry is async appendFile — off critical path  
- Insights fire-and-forget after turn — no TTFT impact  
- Health registry in-memory — O(1) select  
- Classifier pure regex — sub-ms  

## Quality bar for “app profissional”

Met: deterministic policy, failover provenance, opt-out legacy path, local-only telemetry, operator command `/route`.  
Pending ops: enable settings on machine; rebuild CLI (`bun run build`) before daily use.
