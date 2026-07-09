# 2026-07-09 — Ollama-first fleet activated

**Contexto:** Usar todos os modelos Ollama instalados para potencializar autonomy (latência local + qualidade cloud).

## Frota

| Modelo | Uso |
|--------|-----|
| `qwen2.5:7b` | trivial / fallback local |
| `qwen2.5:14b` | standard + default main |
| `qwen3-vl:235b-cloud` | hard + vision |
| `glm-5.1:cloud` | Plan + hard fallback |
| `kimi-k2.6:cloud` | hard/standard fallback |
| `minimax-m3:cloud` | fallback extra |

## Como reaplicar

```powershell
bun run autonomy:ollama
bun run doctor:autonomy:probe
.\start-ollama.ps1
```

## Como validar

1. `/route` — enabled=true, taskRouting preenchido  
2. Prompt "oi" → deve ir para 7b  
3. Prompt com path `src/foo.ts` → 14b  
4. "redesenha arquitetura em vários módulos" → 235b cloud  
5. Se 235b cair → glm/kimi/minimax pela fallback chain  

## Backup settings

Criado automaticamente: `~/.claude/settings.json.bak-ollama-*`
