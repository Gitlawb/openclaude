# Routing Baseline — 2026-07-09

Snapshot do ambiente **antes** do Autonomy Controller. Usar para medir ganhos de latência/custo.

## Profile ativo (`.openclaude-profile.json`)

| Campo | Valor |
|-------|--------|
| profile | `openai` |
| OPENAI_BASE_URL | `https://token-plan-sgp.xiaomimimo.com/v1` |
| OPENAI_MODEL | `mimo-v2.5-pro` |

> Nota: o profile de trabalho atual **não** é Ollama-first; Ollama aparece no `agentModels` para subagentes.

## Modelos Ollama instalados

| Modelo | Tipo | Notas |
|--------|------|--------|
| `qwen2.5:7b` | Local 4.7 GB | Bom candidato a **trivial** |
| `qwen2.5:14b` | Local 9.0 GB | Candidato a **standard** |
| `qwen3-vl:235b-cloud` | Cloud via Ollama | Usado como default/Explore/GP |
| `glm-5.1:cloud` | Cloud | Disponível (settings ainda cita glm-4.6) |
| `minimax-m3:cloud` | Cloud | Disponível |
| `kimi-k2.6:cloud` | Cloud | Disponível |

## agentRouting atual (`~/.claude/settings.json`)

| Agent | Modelo |
|-------|--------|
| Explore | `qwen3-vl:235b-cloud` |
| Plan | `glm-4.6:cloud` ⚠️ ID pode estar desatualizado vs `glm-5.1:cloud` listado |
| general-purpose | `qwen3-vl:235b-cloud` |
| default | `qwen3-vl:235b-cloud` |

## agentModels registrados

- `qwen3-vl:235b-cloud` → `http://localhost:11434/v1`
- `glm-4.6:cloud` → `http://localhost:11434/v1`

**Gap:** 7b/14b locais **não** estão em `agentModels` — o taskRouting da Phase 1 precisa registrá-los.

## Política proposta (Phase 1)

```json
{
  "autonomy": { "enabled": true, "mode": "smart", "autoApplyPolicy": false },
  "agentModels": {
    "qwen2.5:7b": { "base_url": "http://localhost:11434/v1", "api_key": "ollama" },
    "qwen2.5:14b": { "base_url": "http://localhost:11434/v1", "api_key": "ollama" },
    "qwen3-vl:235b-cloud": { "base_url": "http://localhost:11434/v1", "api_key": "ollama" },
    "glm-5.1:cloud": { "base_url": "http://localhost:11434/v1", "api_key": "ollama" },
    "mimo-v2.5-pro": {
      "base_url": "https://token-plan-sgp.xiaomimimo.com/v1",
      "api_key": "${MIMO_API_KEY}"
    }
  },
  "taskRouting": {
    "trivial": "qwen2.5:7b",
    "standard": "qwen2.5:14b",
    "hard": "mimo-v2.5-pro",
    "vision": "qwen3-vl:235b-cloud"
  },
  "fallbackChains": {
    "hard": ["mimo-v2.5-pro", "qwen3-vl:235b-cloud", "glm-5.1:cloud"],
    "standard": ["qwen2.5:14b", "qwen2.5:7b", "mimo-v2.5-pro"],
    "default": ["mimo-v2.5-pro", "qwen3-vl:235b-cloud"]
  }
}
```

Ajustar `api_key` do MIMO conforme o secret real no `.env` (não commitar chaves).

## Métricas a capturar (manual até Phase 4)

| Cenário | Modelo esperado (smart) | TTFT | Tokens | Sucesso? |
|---------|-------------------------|------|--------|----------|
| "oi" / pergunta curta | 7b | | | |
| "corrige bug em um arquivo" | 14b ou mimo | | | |
| "redesenha arquitetura auth" | mimo / 235b | | | |
| screenshot / imagem | qwen3-vl | | | |
| provider principal down | fallback chain | | | |

## Riscos observados no baseline

1. **Tudo pesado no agentRouting** — Explore e default no VL 235B.
2. **Drift de IDs** — settings `glm-4.6:cloud` vs Ollama `glm-5.1:cloud`.
3. **Profile vs routing** — REPL principal em MIMO; subagentes em Ollama cloud.
4. **effortLevel: xhigh** global — pode conflitar com tier `trivial` (Phase 3 deve baixar effort).
