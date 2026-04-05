# BLUEPRINT: op-groundwork
## Tool: `openclaude-ollama-launcher`

> Foundation Operations — Operation Groundwork  
> *"Lay the bedrock before you build the tower."*

---

## Mission

A zero-config first-run TUI/CLI that auto-detects a local Ollama installation, lists available models with metadata (size, quantization, benchmark score), runs a latency/throughput benchmark, and writes an `.openclaude-profile.json` config file. Removes the friction of initial LLM setup for new openclaude users.

---

## Source Files from openclaude (extraction targets)

| File | Role |
|------|------|
| `src/utils/model/ollamaModels.ts` | Ollama model registry, metadata, capability tags |
| `src/utils/providerDiscovery.ts` | Auto-detect local providers (Ollama, LM Studio) |
| `src/utils/providerProfile.ts` | Profile generation and serialization |
| `src/utils/headlessProfiler.ts` | Latency/throughput benchmarking engine |
| `src/utils/startupProfiler.ts` | Cold-start timing utilities |
| `src/utils/queryProfiler.ts` | Per-query metrics collection |

---

## Architecture

```
openclaude-ollama-launcher/
├── src/
│   ├── cli.ts                  # Entry point — arg parsing, mode detection
│   ├── detector.ts             # HTTP probe localhost:11434, enumerate /api/tags
│   ├── benchmarker.ts          # Run N warmup + M timed completions, collect metrics
│   ├── profiler.ts             # Aggregate TTFT, tok/s, cost-per-1k
│   ├── profileWriter.ts        # Serialize .openclaude-profile.json
│   ├── ui/
│   │   ├── ModelList.tsx        # Ink component: scrollable model table
│   │   ├── BenchmarkProgress.tsx # Live progress bar during benchmark
│   │   └── ProfileSummary.tsx   # Final recommendation card
│   └── types.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Data Flow

```
User runs launcher
       │
       ▼
detector.ts ──► GET localhost:11434/api/tags
       │             returns [{name, size, digest, modified_at}]
       ▼
ModelList.tsx ──► user selects model(s) to benchmark
       │
       ▼
benchmarker.ts ──► stream N completions, measure TTFT + tok/s
       │
       ▼
profiler.ts ──► aggregate p50/p95 latency, tok/s, quality score
       │
       ▼
profileWriter.ts ──► write ~/.openclaude-profile.json
       │
       ▼
ProfileSummary.tsx ──► display final recommendation + env vars to set
```

---

## Build Plan

### Phase 1 — Core Detection & Enumeration
- [ ] HTTP client for Ollama REST API (`/api/tags`, `/api/show`)
- [ ] Model metadata parser (quantization, context length, parameter count)
- [ ] Fallback detection for LM Studio (port 1234) and OpenAI-compatible servers

### Phase 2 — Benchmark Engine
- [ ] Warmup runs (discard first 2)
- [ ] Configurable prompt templates (code, chat, reasoning)
- [ ] TTFT measurement via streaming response
- [ ] Tokens/second calculation from stream chunk timestamps
- [ ] Cost estimation using modelCost.ts pricing tables

### Phase 3 — TUI
- [ ] Ink-based model selector with capability tags
- [ ] Real-time benchmark progress with live metric updates
- [ ] Final profile card with environment variable suggestions

### Phase 4 — Output
- [ ] Write `.openclaude-profile.json` (model, baseUrl, apiKey placeholder)
- [ ] Optionally write shell export snippet to stdout
- [ ] `--json` flag for CI/scripting use

---

## Dependencies (from openclaude)

```json
{
  "ink": "^5.x",
  "react": "^18.x",
  "typescript": "^5.x",
  "bun": "^1.x"
}
```

---

## CLI Interface

```bash
# Interactive TUI
openclaude-ollama-launcher

# Auto-select fastest model and write profile
openclaude-ollama-launcher --auto

# Benchmark specific model
openclaude-ollama-launcher --model qwen2.5:7b

# Output JSON, no TUI
openclaude-ollama-launcher --json

# Specify custom Ollama endpoint
openclaude-ollama-launcher --base-url http://192.168.1.10:11434
```

---

## Output: `.openclaude-profile.json`

```json
{
  "provider": "ollama",
  "model": "qwen2.5:7b",
  "baseUrl": "http://localhost:11434/v1",
  "apiKey": "ollama",
  "benchmark": {
    "ttft_p50_ms": 120,
    "tokens_per_sec": 42.7,
    "context_length": 32768,
    "quantization": "Q4_K_M"
  },
  "generatedAt": "2026-04-05T19:45:00Z"
}
```

---

*Branch: `foundation/op-groundwork` | Parent repo: FoundationOperations/openclaude*
