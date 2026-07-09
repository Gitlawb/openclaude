# 2026-07-09 — Phase 1 Autonomy shipped

**Contexto:** Implementação da Phase 1 do programa de performance/autonomia no OpenClaude.

**Sintoma:** agentRouting mandava Explore/default para VL 235B; sem política por dificuldade da tarefa.

**Ação:**
- Módulo `src/services/autonomy/` (signals, classifier, routePolicy)
- Settings: `autonomy`, `taskRouting`, `fallbackChains`
- `resolveAgentProvider` aceita `userText` / `hasImage`
- `runAgent` passa texto do prompt para classificação
- `start-ollama.ps1 -AutonomyMode smart|fast|code|quality|fixed`
- Docs em GUIA_USO + superpowers

**Resultado:** 36 testes unitários passando (`bun run test:autonomy`).

**Política sugerida (aplicar em settings do usuário):**

```json
{
  "autonomy": { "enabled": true, "mode": "smart", "classifier": "heuristic" },
  "taskRouting": {
    "trivial": "qwen2.5:7b",
    "standard": "qwen2.5:14b",
    "hard": "mimo-v2.5-pro",
    "vision": "qwen3-vl:235b-cloud"
  }
}
```

**Como ativar sem editar settings:**

```powershell
.\start-ollama.ps1 -Mode local -AutonomyMode smart
```

(Requer `taskRouting` + modelos em `agentModels` para efeito completo.)

**Próximo:** Phase 2 — health registry + fallback em falha de API.
