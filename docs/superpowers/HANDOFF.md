# openclaude-obsidian — Handoff Document

> **Para retomar:** abra Claude Code nesta pasta e diga exatamente:
> *"Leia `docs/superpowers/HANDOFF.md` e retome de onde paramos."*
> Ou copie o kick-off prompt da Seção 11.

**Última atualização:** 2026-05-01 (sessão 6)
**Branch ativa:** `feat/serve` (server) + `feat/plugin` (plugin, worktree em `.worktrees/plugin/`)
**Tags:** `phase-1-server-complete` ✅ + **`phase-2-plugin-complete`** ✅ (a criar)
**Plano #1 COMPLETO (20/20 tasks)** | **Plano #2 COMPLETO (10/10 tasks)**
**Próxima tarefa:** Tag `phase-2-plugin-complete` + merge/PR + Plano #3

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

### Plano #1 — Servidor HTTP (`feat/serve`)

**Branch:** `feat/serve` | **Tag:** `phase-1-server-complete`
**Testes:** 93 pass / 0 fail (`bun test src/serve/`)
**Typecheck:** zero erros em `src/serve/`

Tasks 1-20 COMPLETAS — ver histórico no HANDOFF anterior (sessão 5).

---

### Plano #2 — Plugin Obsidian (`feat/plugin`, worktree `.worktrees/plugin/`)

**Branch:** `feat/plugin` (worktree em `.worktrees/plugin/`)
**Testes:** 21 pass / 0 fail (`bun test tests/` dentro de `.worktrees/plugin/plugin/`)
**Typecheck:** zero erros
**Build:** `main.js` + `styles.css` + `manifest.json` presentes

**Commits da branch `feat/plugin` (mais recentes primeiro):**
```
25428da  fix(plugin): track restart timer, send preset in chat request
2c3fbae  fix(plugin): command-hub inject error handling and health-check sidebar
0cc1805  feat(plugin): add Ctrl+K command hub modal with quick actions
188373e  feat(plugin): add vault installer script
9d65b2d  fix(plugin): diff-modal double-apply guard, reason optional, safer err cast
3d5fe34  feat(plugin): add diff preview modal (before/after, apply/reject)
401d6e9  fix(plugin): sidebar-view quality issues (listener leak, exhaustiveness...)
faee53d  fix(plugin): sidebar-view spec gaps (status-dot class, tool_result...)
[Task 7 impl, Tasks 1-6 commits...]
```

**Tasks concluídas do Plano #2 (10 de 10 — COMPLETO ✅):**
- ✅ Task 1: Plugin scaffold (manifest, package.json, tsconfig, esbuild, styles.css)
- ✅ Task 2: types.ts + main.ts stub
- ✅ Task 3: SSE parser — `parseSseBuffer()` — TDD (6 testes)
- ✅ Task 4: ApiClient — HTTP + SSE chat stream — TDD (7 testes)
- ✅ Task 5: ServerManager — spawn/kill/health-poll/auto-restart — TDD (8 testes)
- ✅ Task 6: SettingsTab + wiring main.ts
- ✅ Task 7: SidebarView — chat log, status dot, context card, SSE handlers, pending poll
- ✅ Task 8: DiffPreviewModal — before/after grid, apply/reject, Enter shortcut
- ✅ Task 9: CommandHubModal — 6 ações preset, filtro fuzzy, navegação teclado
- ✅ Task 10: install.mjs + scripts root (`plugin:build`, `plugin:install`)

**Arquitetura entregue:**
```
plugin/src/
├── main.ts           — OpenClaudePlugin, wires all modules
├── types.ts          — PluginSettings, SseEvent, PendingEdit, ChatRequest
├── sse-parser.ts     — parseSseBuffer() pure fn (no Obsidian dep)
├── api-client.ts     — ApiClient: fetch + SSE (no Obsidian dep)
├── server-manager.ts — ServerManager: spawn/kill/poll (no Obsidian dep)
├── settings.ts       — SettingsTab
├── views/
│   └── sidebar-view.ts    — SidebarView: main chat UI
└── modals/
    ├── diff-preview-modal.ts  — DiffPreviewModal
    └── command-hub-modal.ts   — CommandHubModal (Ctrl+K)
plugin/
├── install.mjs       — copies artifacts to vault
├── manifest.json
├── package.json
└── styles.css
```

---

## 3. Planos completos ✅

**Plano #1:** 20/20 tasks. Tag `phase-1-server-complete`. Servidor HTTP pronto.
**Plano #2:** 10/10 tasks. Tag `phase-2-plugin-complete` (a criar). Plugin Obsidian pronto para instalação.

---

## 4. Próximos passos

**Imediato:**
1. Criar tag `phase-2-plugin-complete` na branch `feat/plugin`
2. Abrir PR: `feat/plugin` → `main` (ou merge direto)

**Plano #3** — Features completas (Dataview L2 painel, Mermaid render, slash commands).
**Plano #4** — Enforcement P3 + CLI installer + testes E2E Playwright.

**Para instalar o plugin num vault agora:**
```bash
cd .worktrees/plugin/plugin
npm run build
node install.mjs "G:/Meu Drive/Desenvolvimento de Sistema - Projetos/Ambiente de Desenvolvimento/Energinova_Hub"
```
Depois em Obsidian: Settings → Community Plugins → enable "OpenClaude".

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
- Plano #1 COMPLETO: feat/serve, tag phase-1-server-complete, 93 testes
- Plano #2 COMPLETO: feat/plugin (worktree .worktrees/plugin/), 21 testes, plugin instalável
- Próximo: tag phase-2-plugin-complete + PR feat/plugin→main + escrever Plano #3

Leia HANDOFF.md, me dê um resumo de 3 linhas confirmando o estado,
e sugira os próximos passos (tag + PR ou instalar no vault para testar).

Sem re-brainstorming. Sem re-review do design. Sem reabrir decisões fechadas.
```

---

## 12. Check-list pro Claude de amanhã

Antes de qualquer tool call, confirmar:
- [ ] Está em `e:/Agente_OpenClaude_Segundo_cérebro/`?
- [ ] Branch atual é `feat/serve`, tag `phase-1-server-complete` existe?
- [ ] `bun run test:serve` mostra 93 pass?
- [ ] HANDOFF.md foi lido (este arquivo)?

Se todos sim: escrever Plano #2 (plugin Obsidian) com `superpowers:writing-plans`.

Smoke útil pra confirmar que nada regrediu:
```bash
bun run build
node dist/cli.mjs serve --port 7778 &
sleep 2
TOKEN=$(cat "$USERPROFILE/.openclaude/server-token" 2>/dev/null || cat ~/.openclaude/server-token)
curl -s http://127.0.0.1:7778/health
curl -sN -X POST http://127.0.0.1:7778/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"message":"test"}' -m 10
kill %1
```
