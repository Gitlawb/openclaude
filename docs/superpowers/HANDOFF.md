# openclaude-obsidian — Handoff Document

> **Para retomar:** abra Claude Code nesta pasta e diga exatamente:
> *"Leia `docs/superpowers/HANDOFF.md` e retome de onde paramos."*
> Ou copie o kick-off prompt da Seção 11.

**Última atualização:** 2026-04-23 (sessão 2)
**Branch ativa:** `feat/serve`
**Próxima tarefa:** Task 12 do Plano #1 (integrar LLM real)

---

## 1. O que estamos construindo

**Produto:** `openclaude-obsidian` — plugin Obsidian + servidor HTTP local que expõe o OpenClaude como agente dentro do segundo cérebro do usuário (vaults Obsidian com estrutura PARA/MOC/Zettelkasten).

**Arquitetura de 3 camadas:**
1. **Plugin Obsidian** (TypeScript, ~2000-3000 loc) — UX: sidebar, Ctrl+K hub, diff modal
2. **Servidor `openclaude serve`** (novo módulo em `src/serve/`) — ponte HTTP/SSE sobre o core
3. **OpenClaude Core** (existente, sem mudanças estruturais)

**Documentos-mestre no repo:**
- Spec completo: [`docs/superpowers/specs/2026-04-23-openclaude-obsidian-design.md`](specs/2026-04-23-openclaude-obsidian-design.md)
- Plano Phase 1 (20 tasks): [`docs/superpowers/plans/2026-04-23-openclaude-obsidian-phase-1-server.md`](plans/2026-04-23-openclaude-obsidian-phase-1-server.md)

---

## 2. Estado atual (confirmado por testes)

**Branch:** `feat/serve` (criada a partir de `main`)
**HEAD:** `9bbda61`

**Commits na branch (18 total, mais recentes primeiro):**
```
9bbda61  feat(serve): add SSE helper and /chat endpoint with pluggable agent
ee05ab8  feat(serve): add /sessions CRUD endpoints
47fd10a  feat(serve): add SessionManager with JSONL persistence
f358907  feat(serve): add vault registry persistence (~/.openclaude/vaults.yml)
4989ad4  feat(serve): add tripwires for destructive shell and protected config writes
b2cd10a  feat(serve): add vault-bound path resolution (blocks .. escapes)
caa77cd  feat(serve): add typed ServerError with HTTP status mapping
0423881  docs: add HANDOFF.md for zero-friction session resumption
ded8603  fix(serve): dispatch serve subcommand before banner to keep stdout clean
9f83134  fix(serve): resolve package.json path in both source and bundled layouts
7387c0d  refactor(serve): fail fast on bad package.json and tighten health test
f1b0025  feat(serve): add /health endpoint (public, no auth)
4d115be  refactor(serve): bound hits map eviction and guard malformed URI decode
2b51bdc  feat(serve): add HTTP core with routing, CORS, and rate limit
ae499f5  fix(serve): harden token auth (atomic create, hash-based constant time)
60d3523  feat(serve): add token generator + bearer middleware with constant-time compare
cf3dd7a  refactor(serve): harden scaffold per code review
9994f77  feat(serve): scaffold openclaude serve subcommand
```

**Tasks concluídas do Plano #1 (11 de 20):**
- ✅ Task 1: Scaffold `src/serve/` + CLI subcommand
- ✅ Task 2: Token auth (constant-time hash)
- ✅ Task 3: HTTP core (routing, CORS, rate limit)
- ✅ Task 4: `/health` endpoint (público)
- ✅ Task 5: Typed errors (`ServerError`, `ErrorCode`, `errorResponse`)
- ✅ Task 6: Path normalization vault-bound (`resolveInsideVault`)
- ✅ Task 7: Tripwires (bash + fs blocklist)
- ✅ Task 8: Vault registry YAML (hand-rolled parser, no dep)
- ✅ Task 9: Session manager JSONL persist
- ✅ Task 10: `/sessions` CRUD endpoints
- ✅ Task 11: SSE helper + `/chat` com mock agent pluggable

**Verificado em produção (manual smokes):**
- `openclaude serve --port 7777` inicia sem banner no stdout (só JSON)
- `GET /health` → 200 com `{status, version, uptime_ms}`
- `/sessions` CRUD — GET/POST/GET/DELETE/GET roundtrip com typed 404 final
- `/chat` streaming SSE — `curl -N POST /chat` devolve `event: token` + `event: done`
  com `sessionId` auto-criado
- Token em `~/.openclaude/server-token` (64 hex, mode 0600 no Unix)

**Testes automatizados:** 54 pass / 0 fail / 89 expect() calls / ~400ms
  — rodar com `bun test src/serve/`
  — 12 arquivos de teste (antes: 4)

**Typecheck:** zero erros em `src/serve/` (erros pré-existentes em outros módulos inalterados).

---

## 3. Tasks restantes do Plano #1 (9 de 20)

Ordem de execução:

| # | Task | Entrega |
|---|---|---|
| 12 | Integração real OpenClaude Query engine | **Chat funciona com LLM real** (próxima) |
| 13 | Pending edits store + endpoints | P3 preview flow |
| 14 | Shadow backup + `/backups` | Reversibilidade |
| 15 | `/config`, `/models`, `/vaults` | Config endpoints |
| 16 | `/tools/search` (cross-vault) | Busca |
| 17 | `/tools/dataview` + `/tools/analyze-results` | DQL generator |
| 18 | `/tools/mermaid-graph` | Grafos on-demand |
| 19 | Security matrix E2E | **Inclui fix: tripwire fs regex pra aceitar `[\\/]` (Windows)** |
| 20 | README + tag `phase-1-server-complete` | **Phase 1 COMPLETA** |

Cada task tem código completo + testes TDD no arquivo do plano.

**Task 12 é diferente das anteriores** — primeira que modifica código fora de
`src/serve/`. O Step 1 do plano pede um `grep` investigativo pra localizar o
entry point real do streaming (`query()` ou similar). Não é copy-paste; é um
adapter que traduz o formato do core OpenClaude para o contrato `AgentFn`
(AsyncIterable<AgentEvent>) definido em Task 11.

---

## 4. Depois do Plano #1

**Plano #2** — Plugin Obsidian (sidebar + Ctrl+K + chat UI). **Não escrito ainda.** Espera-se escrever quando Phase 1 terminar.

**Plano #3** — Features completas (Dataview L2 painel, Mermaid render, slash commands).

**Plano #4** — Enforcement P3 + CLI installer + testes E2E Playwright.

**Estimativa até "agente funcionando no Obsidian":** ~6-7 sessões como a de 2026-04-23.

---

## 5. Decisões-chave já fechadas (NÃO re-discutir)

Registradas no spec, Seção 16. Destaques:

- **Plugin Obsidian** (não VS Code extension, não web app separado) — A
- **Servidor HTTP local** auto-iniciado pelo plugin — A2 + L2
- **Auth:** token automático em `~/.openclaude/server-token` — S2
- **Layout:** híbrido — sidebar fina direita + Ctrl+K modal hub — D
- **Permissões:** preset P3 "balanceado" default, configurável por vault
- **Backup:** shadow automático pré-edit em `.openclaude-backups/`, retenção 30 dias
- **Multi-vault:** cross-vault search no MVP; editing cross-vault v2
- **Dataview:** Níveis 1+2 no MVP; níveis 3+4 em v2
- **Grafo:** Mermaid on-demand no MVP; interativo v2
- **Git nos vaults:** não requerido (usuário não tem); shadow backup substitui

---

## 6. Questões em aberto (decidir antes de release, não bloqueantes)

Listadas no spec Seção 15:
1. Nome final do projeto (`openclaude-obsidian` vs Sinapse vs Neurônio vs Hippocampus)
2. Distribuição: Obsidian Community Plugins vs GitHub Releases
3. Telemetria opt-in
4. Beta privado em Energinova_Hub
5. Integração com Dataview (assumir instalado vs detectar)
6. Registrar 6+ vaults no installer default ou opt-in

---

## 7. Setup técnico conhecido

- **Runtime:** Bun 1.3.11+
- **Tests:** `bun test src/serve/`
- **Build:** `bun run build` (output: `dist/cli.mjs`)
- **Typecheck:** `bun run typecheck`
- **CLI:** `node dist/cli.mjs serve --port 7777`
- **Package name:** `@gitlawb/openclaude`
- **Platform user:** Windows 11, PowerShell / Git Bash

**Vaults do usuário** (registrados em `~/.claude/settings.json`):
- Energinova_Hub (G:) — segundo cérebro principal (PARA/MOC/Zettelkasten)
- FinPower (G:) — projeto
- SigBlock (G:) — projeto
- Power_Project (G:) — projeto
- Propostas_3.0 (G:) — projeto
- Gerenciador de Projetos (E:) — projeto
- Nenhum tem git inicializado.

**Providers configurados:**
- Default: `qwen3-vl:235b-cloud` via Ollama
- Alternativos: OpenAI GPT-4o (pago), OpenRouter (várias opções free + paid)

---

## 8. Processo de desenvolvimento adotado

1. **Skills ativas:** `superpowers:subagent-driven-development` + `superpowers:writing-plans`
2. **Por task:** Implementer subagent (TDD) → Spec compliance reviewer → Code quality reviewer → fixes se necessário → commit
3. **Manual smoke obrigatório** antes de marcar task complete se tocou em build/CLI (lição aprendida: testes unitários não pegam bugs de bundle)
4. **Revisão entre tasks:** Claude principal revisa reports antes de despachar próxima

---

## 9. Lições aprendidas (valer pra próximas tasks)

**Sessão 1 (Tasks 1-4):**
- **Bundler flatten:** `import.meta.url` em `dist/cli.mjs` != em `src/serve/handlers/*.ts`. Use `findPackageJson` walking up, não path relativo fixo.
- **stdout pollution:** fast-paths de CLI devem vir ANTES de `printStartupScreen()` pra daemons manterem JSON limpo.
- **TOCTOU em arquivos sensíveis:** `openSync('wx', 0o600)` > `existsSync` + `writeFileSync`.
- **Constant-time compare:** hash ambos os lados antes de `timingSafeEqual` pra eliminar length leak.
- **Rate limit cleanup:** `hits` map precisa de eviction timer ou cresce sem limite.
- **decodeURIComponent:** throws em input malformado — wrap em try/catch no route matcher.

**Sessão 2 (Tasks 5-11):**
- **Stateful singletons em `index.ts` precisam ir dentro de `startServer()`**, não module-scope. Tests rotacionam `process.env.HOME` em `beforeEach`; module-scope aliasa todos os tests pro primeiro home. Aplicado em `SessionManager` (Task 10) e `chatRoute(sm)` (Task 11). `setMockAgent(defaultMock)` continua em module-scope porque é idempotente e tests sobrescrevem.
- **Testes com paths hard-coded Unix (`/vault`) falham em Windows** porque `path.resolve` normaliza pro drive. Sempre computar expected via `resolve()` — função em si é cross-platform, só a assertion string não é. Aplicado em Task 6 (paths).
- **Gap conhecido a fechar em Task 19:** tripwire fs regex em `src/serve/tripwires.ts` usa `\/` literal; não pega paths Windows `\`. Extender pra `[\\/]` na security matrix E2E antes de Phase 1 fechar.
- **JSONL é a escolha certa pra append-only logs** (sessões): crash-resilient, O(1) append, streamable. `filter(Boolean)` no split drop-a linha vazia trailing sem esforço. Metadata (`createdAt/updatedAt`) delegada ao fs via `statSync` (`birthtimeMs || ctimeMs` cobre ext3/ext4 antigos).
- **SSE `sse.end()` deve estar em `finally`** — garante fechamento do stream mesmo se o agent generator throw. Send `event: error` no catch ANTES do finally pra cliente saber o que rolou.
- **Union discriminada > interface genérica** pra protocolos de eventos. `AgentEvent` força narrowing por `evt.event`, compilador lista consumers quando adicionar evento novo. Aplicado em Task 11.

---

## 10. Comandos de retomada (cola-e-roda)

### Verificar que branch está OK
```bash
cd "e:/Agente_OpenClaude_Segundo_cérebro"
git checkout feat/serve
git log --oneline feat/serve ^main
bun test src/serve/        # deve mostrar 19 pass
```

### Rodar o servidor pra testar
```bash
bun run build
node dist/cli.mjs serve --port 7777
# em outro terminal:
curl http://127.0.0.1:7777/health
```

### Limpar processos node esquecidos
```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
```

---

## 11. Kick-off prompt para nova sessão (copiar e colar)

```
Retomando projeto openclaude-obsidian.

Contexto completo em: docs/superpowers/HANDOFF.md

Estado atual:
- Branch feat/serve, commit HEAD: 9bbda61
- Plano #1 Tasks 1-11 concluídas, 54 testes verdes
- Próxima: Task 12 (integrar Query engine OpenClaude real no /chat)

Task 12 é diferente — Step 1 pede grep investigativo em src/query* /
src/assistant/ pra localizar o streaming real. Não é copy-paste; é
escrever um adapter de AsyncIterable<{role, content}> (core) pra
AsyncIterable<AgentEvent> (definido em src/serve/handlers/chat.ts).

Leia HANDOFF.md e o plano, me dê um resumo de 3 linhas confirmando que
entendeu o estado, e comece pelo grep investigativo da Task 12.

Sem re-brainstorming. Sem re-review do design. Sem reabrir decisões fechadas.
```

---

## 12. Check-list pro Claude de amanhã

Antes de qualquer tool call, confirmar:
- [ ] Está em `e:/Agente_OpenClaude_Segundo_cérebro/`?
- [ ] Branch atual é `feat/serve`, HEAD é `9bbda61`?
- [ ] `bun test src/serve/` mostra 54 pass?
- [ ] Plano em `docs/superpowers/plans/2026-04-23-openclaude-obsidian-phase-1-server.md` existe?
- [ ] HANDOFF.md foi lido (este arquivo)?

Se todos sim, vá pra Task 12. Comece pelo grep investigativo do Step 1 da task.

Smoke útil pra confirmar que nada regrediu:
```bash
bun run build
node dist/cli.mjs serve --port 7778 &
sleep 2
TOKEN=$(cat "$USERPROFILE/.openclaude/server-token" 2>/dev/null || cat ~/.openclaude/server-token)
curl -sN -X POST http://127.0.0.1:7778/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"message":"test"}' -m 5
# Esperado: event: token data: {"text":"echo: test"} / event: done ...
kill %1
```
