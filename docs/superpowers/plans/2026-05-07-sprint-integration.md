# Sprint Integration — Merge, HANDOFF e Memória

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate T2 (server) and T3 (plugin) branches into `feat/serve`, merge to `main`, atualizar o HANDOFF e a memória do Claude para refletir o estado real do projeto.

**Architecture:** Esta trilha não produz código novo — ela integra o trabalho das outras duas trilhas. Deve rodar **depois** que T2 e T3 estiverem completos e seus testes passando.

**Tech Stack:** git, bun test, bash

**Pré-requisito:** T2 (`2026-05-07-server-improvements.md`) e T3 (`2026-05-07-plugin-phase4-ui.md`) concluídos e testados.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `docs/superpowers/HANDOFF.md` | Atualizar para refletir Phase 3+4 completas e estado pós-sprint |

---

## Task 1: Verificar estado das branches antes do merge

- [ ] **Step 1: Confirmar T2 completo**

```bash
cd "e:/Agente_OpenClaude_Segundo_cérebro"
git log feat/serve --oneline | head -5
bun test src/serve/ --reporter=verbose 2>&1 | tail -5
```

Expected: `bun test` mostra todos passando (≥ 100 testes). Deve incluir commits de permissions.ts e registry fix.

- [ ] **Step 2: Confirmar T3 completo**

```bash
git log feat/plugin --oneline | head -5
cd plugin && bun test tests/ --reporter=verbose 2>&1 | tail -5
```

Expected: todos passando (≥ 25 testes). Deve incluir commits de server-manager env vars e thought-tool display.

- [ ] **Step 3: Verificar zero erros de tipo em ambas**

```bash
bun run typecheck 2>&1 | grep -c "error TS" || echo "zero erros"
cd plugin && npx tsc --noEmit 2>&1 | grep -c "error TS" || echo "zero erros"
```

Expected: `zero erros` em ambos.

---

## Task 2: Merge feat/plugin → feat/serve

- [ ] **Step 1: Checkout feat/serve**

```bash
git checkout feat/serve
```

- [ ] **Step 2: Merge feat/plugin**

```bash
git merge feat/plugin --no-ff -m "merge(plugin): integrate Phase 4 UI — provider env vars + thought tool display"
```

- [ ] **Step 3: Resolver conflitos se existirem**

Conflitos esperados (se houver):
- `docs/superpowers/HANDOFF.md` — manter versão de feat/serve, será atualizada no Task 3
- `package.json` — manter ambas as mudanças (scripts de plugin + server)
- `src/serve/types.ts` vs `plugin/src/types.ts` — arquivos diferentes, sem conflito esperado

Para cada conflito:
```bash
git diff --name-only --diff-filter=U  # lista arquivos em conflito
```

Resolver manualmente e marcar como resolvido:
```bash
git add <arquivo-resolvido>
git merge --continue
```

- [ ] **Step 4: Rodar suite completa pós-merge**

```bash
bun test src/serve/ --reporter=verbose 2>&1 | tail -10
cd plugin && bun test tests/ --reporter=verbose 2>&1 | tail -10
```

Expected: todos passando. Zero regressões.

- [ ] **Step 5: Build completo**

```bash
bun run build
cd plugin && bun run build
```

Expected: ambos sem erros.

---

## Task 3: Atualizar HANDOFF.md

- [ ] **Step 1: Abrir o arquivo e atualizar o cabeçalho**

No topo de `docs/superpowers/HANDOFF.md`, atualizar:

```markdown
**Última atualização:** 2026-05-07 (sessão 7 — sprint paralelo C)
**Branch ativa:** `feat/serve` (integrada com `feat/plugin`)
**Tags:** `phase-1-server-complete` ✅ + `phase-2-plugin-complete` ✅ + `phase-3-complete` ✅ + `phase-4-complete` ✅
**Planos 1-4 COMPLETOS**
**Próxima tarefa:** PR feat/serve → main + teste beta no vault Energinova_Hub
```

- [ ] **Step 2: Atualizar Seção 2 (Estado atual)**

Substituir/adicionar abaixo da seção do Plano #2:

```markdown
### Plano #3 — Vault Tools + OpenAI Function Calling (`feat/serve`)

**Branch:** `feat/serve` | **Tag:** `phase-3-complete` (a criar)
**Funcionalidades entregues:**
- ✅ OpenAI function-calling agentic loop (list_vault, read_note, search_vault, write_note)
- ✅ delete_note / rename_note / move_note com pending edit
- ✅ updateWikilinks automático no apply de rename/move
- ✅ vaultUtils.ts com walk, searchVault, readNote, vaultRelative
- ✅ Tool registry pattern (registry.ts, vaultTools.ts, webTools.ts, formatTools.ts)

### Plano #4 — Second Brain Agent (`feat/serve`)

**Branch:** `feat/serve` | **Tag:** `phase-4-complete` (a criar)
**Funcionalidades entregues:**
- ✅ Thought tools: structure_thought, refine_argument, counter_argument
- ✅ Persona "argumentative thinking partner" (system prompt reescrito)
- ✅ web_search + fetch_page via Brave Search API
- ✅ summarize_notes, format_note, suggest_links (formatTools)
- ✅ Suggestions SSE event (chips clicáveis no plugin)
- ✅ Conversation history wiring
- ✅ Provider agnosticism: thought tools ativados via OPENAI_API_KEY/OPENAI_BASE_URL
- ✅ P3 permission middleware (conservador/balanceado/agressivo)
- ✅ Plugin: server-manager passa env vars de provider automaticamente
- ✅ Plugin: thought tools mostram blocos colapsáveis com resultado
```

- [ ] **Step 3: Atualizar Seção 10 (Comandos de retomada)**

Atualizar o smoke test para incluir thought tools:

```markdown
### Verificar que o sistema está OK
```bash
cd "e:/Agente_OpenClaude_Segundo_cérebro"
git checkout feat/serve
bun test src/serve/       # ≥ 100 pass
cd plugin && bun test tests/  # ≥ 25 pass
```

### Rodar servidor com Ollama
```bash
bun run build
OPENAI_BASE_URL="http://localhost:11434/v1" \
OPENAI_API_KEY="ollama" \
OPENCLAUDE_MODEL="qwen3-vl:235b-cloud" \
CLAUDE_CODE_USE_OPENAI="1" \
  node dist/cli.mjs serve --port 7777
```

### Testar thought tools via curl
```bash
TOKEN=$(cat ~/.openclaude/server-token 2>/dev/null || cat "$USERPROFILE/.openclaude/server-token")
curl -sN -X POST http://127.0.0.1:7777/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"message":"estruture este argumento em format toulmin: dados abertos melhoram democracia"}' \
  -m 60
```
```

- [ ] **Step 4: Atualizar Seção 11 (Kick-off prompt)**

```markdown
### Kick-off prompt atualizado (2026-05-07)

```
Retomando projeto openclaude-obsidian.

Contexto completo em: docs/superpowers/HANDOFF.md

Estado atual:
- Phases 1-4 COMPLETAS (feat/serve integrado com feat/plugin)
- Thought tools funcionam com Qwen3/Ollama (provider default)
- Plugin exibe blocos colapsáveis para thought tools
- P3 permission middleware ativo (preset: balanceado default)
- Wikilinks atualizam automaticamente no rename/move
- Próximo: PR feat/serve → main + beta no vault Energinova_Hub

Leia HANDOFF.md, me dê um resumo de 3 linhas confirmando o estado
e sugira os próximos passos.

Sem re-brainstorming. Sem re-review do design. Sem reabrir decisões fechadas.
```
```

- [ ] **Step 5: Commit o HANDOFF atualizado**

```bash
git add docs/superpowers/HANDOFF.md
git commit -m "docs(handoff): update to post-sprint state — phases 1-4 complete"
```

---

## Task 4: Criar tags e PR para main

- [ ] **Step 1: Criar tags para as phases concluídas**

```bash
git tag phase-2-plugin-complete  # se ainda não existe
git tag phase-3-complete
git tag phase-4-complete
```

- [ ] **Step 2: Verificar se `main` está limpo antes do PR**

```bash
git log main..feat/serve --oneline | wc -l
```

Expected: ≥ 56 commits acima do main (o trabalho das 4 phases).

- [ ] **Step 3: Criar PR (ou merge direto se solo)**

Se estiver trabalhando em repositório pessoal (sem review obrigatório):

```bash
git checkout main
git merge feat/serve --no-ff -m "feat: phases 1-4 complete — server + plugin + second brain agent"
```

Se precisar de PR via GitHub CLI:

```bash
gh pr create \
  --base main \
  --head feat/serve \
  --title "feat: phases 1-4 complete — openclaude-obsidian server + plugin + second brain agent" \
  --body "$(cat <<'EOF'
## O que foi feito

Integração completa das 4 phases do projeto openclaude-obsidian:

- **Phase 1:** Servidor HTTP com auth, SSE, sessions, backup, security matrix (93+ testes)
- **Phase 2:** Plugin Obsidian — sidebar, DiffModal, CommandHub, ServerManager
- **Phase 3:** Vault tools com function-calling loop (list/read/search/write/delete/rename/move + wikilinks)
- **Phase 4:** Second Brain Agent — thought tools, persona argumentativa, web search, P3 permissions

## Melhorias do sprint paralelo

- Thought tools agora funcionam com Qwen3/Ollama (sem CLAUDE_CODE_USE_OPENAI manual)
- Plugin passa env vars de provider automaticamente ao spawnar o servidor
- Thought tools mostram blocos colapsáveis no sidebar
- P3 permission middleware (conservador/balanceado/agressivo)

## Teste

`bun test src/serve/` — ≥ 100 pass  
`cd plugin && bun test tests/` — ≥ 25 pass
EOF
)"
```

---

## Task 5: Atualizar memória do Claude

Após o merge, atualizar o arquivo de memória do projeto para refletir o estado atual.

- [ ] **Step 1: Atualizar `project_state.md`**

Abrir `C:\Users\User\.claude\projects\E--Agente-OpenClaude-Segundo-c-rebro\memory\project_state.md` e substituir o conteúdo com:

```markdown
---
name: Project state openclaude-obsidian
description: Estado de desenvolvimento do projeto openclaude-obsidian — Phases 1-4 completas, sprint paralelo integrado
type: project
---
# openclaude-obsidian — estado atual

**Meta do projeto:** Plugin Obsidian + servidor HTTP local que expõe OpenClaude como agente dentro dos vaults do usuário. 3 camadas: Plugin (TS) → Servidor (src/serve/) → OpenClaude Core.

**Branch ativa:** `feat/serve` (integrada com feat/plugin, pronta para merge em main)
**Tags:** phase-1-server-complete ✅ phase-2-plugin-complete ✅ phase-3-complete ✅ phase-4-complete ✅

## O que existe hoje

- Servidor HTTP em `src/serve/` — auth, SSE, sessions, backup, pending edits, vault tools, web tools, format tools, thought tools, P3 permissions
- Plugin em `plugin/` — sidebar, DiffModal, CommandHub, ServerManager com env var injection, thought-tool colapsável
- Tool registry pattern com buildRegistry(ctx)
- lightweightOpenAIAgent com function-calling loop (max 8 turns)
- Provider agnosticism: thought tools ativados via OPENAI_API_KEY ou OPENAI_BASE_URL
- Suggestions chips, wikilinks update no rename/move, P3 middleware
- ≥ 100 testes servidor + ≥ 25 testes plugin

## O que FALTA

- Teste beta com vault real (Energinova_Hub)
- CLI install (`openclaude obsidian install`)
- Dataview Nível 2 completo no plugin (server side OK, UI parcial)
- E2E smoke com Playwright

**Why:** Próxima sessão = instalar no vault real e coletar feedback de uso.

**How to apply:** Iniciar qualquer sessão lendo HANDOFF.md e rodando `bun test src/serve/` + `bun test plugin/tests/`.
```

- [ ] **Step 2: Confirmar que MEMORY.md ainda aponta para project_state.md**

```bash
cat "C:\Users\User\.claude\projects\E--Agente-OpenClaude-Segundo-c-rebro\memory\MEMORY.md" | grep project
```

Expected: linha `- [Project state](project_state.md)` presente.

---

## Checklist pós-sprint

- [ ] `bun test src/serve/` — ≥ 100 testes passando
- [ ] `cd plugin && bun test tests/` — ≥ 25 testes passando
- [ ] Merge feat/serve → main completo (ou PR aberto)
- [ ] HANDOFF.md atualizado com estado das 4 phases
- [ ] Tags `phase-3-complete` e `phase-4-complete` criadas
- [ ] Memória do Claude atualizada
- [ ] Próximo passo documentado: beta no Energinova_Hub
