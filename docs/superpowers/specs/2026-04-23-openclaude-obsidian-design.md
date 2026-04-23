# Design — openclaude-obsidian

**Data:** 2026-04-23
**Autor:** Alan + Claude (brainstorming)
**Status:** Draft aguardando revisão do usuário
**Nome do projeto (provisório):** `openclaude-obsidian` — sujeito a renomear (candidatos: Sinapse, Neurônio, Hippocampus)

---

## 1. Resumo executivo

Plugin do Obsidian + servidor HTTP local que expõe o OpenClaude como agente dentro do segundo cérebro do usuário. Objetivo: acelerar consulta, edição e criação de conteúdo nas notas `.md` do Obsidian respeitando wikilinks, frontmatter, tags e a estrutura PARA/MOC/Zettelkasten existente.

A arquitetura é composta por 3 camadas:
1. **Plugin Obsidian** (UX puro) — sidebar direita + hub Ctrl+K
2. **Servidor OpenClaude** (`openclaude serve`) — ponte HTTP/SSE sobre o tool loop existente
3. **OpenClaude Core** (código atual sem mudanças estruturais)

O plugin reusa totalmente a configuração existente do OpenClaude (`~/.claude/settings.json`, `.env`, `.openclaude-profile.json`) e adiciona configuração específica por vault em `.openclaude/` dentro de cada vault.

---

## 2. Escopo

### Dentro do MVP (v1)

- Plugin Obsidian com sidebar direita (chat + contexto da nota ativa) + hub Ctrl+K
- Servidor local auto-iniciado pelo plugin (L2), autenticação via token automático (S2)
- Chat streaming com contexto da nota ativa e histórico persistente
- Busca cross-vault via agente (múltiplos vaults registrados)
- Ações na nota ativa (resumir, expandir em Zettels, gerar MOC, adicionar backlinks)
- Slash commands customizáveis por vault (`.openclaude/commands.yml`)
- Dataview Nível 1 (agente gera DQL) + Nível 2 (painel interativo com filtros, charts e insights do agente)
- Grafos on-demand em Mermaid (até 50 nós, profundidade 3)
- Permission model P3 híbrido com 3 presets (conservador/balanceado/agressivo)
- Diff preview modal antes de aplicar edits (default)
- Shadow backup automático pré-edit (`.openclaude-backups/`, retenção 30 dias)
- Backup history view com restore 1-clique
- Health check / autodiagnóstico com correção 1-clique
- CLI de instalação automatizada (`openclaude obsidian install`)

### Fora do MVP (v1.5 e v2)

- v1.5: renderer de widget custom dentro das notas (Dataview Nível 3), drag-drop de notas, prompts salvos
- v2: dashboard canvas drag-drop (Dataview Nível 4), grafo interativo com filtros UI avançados, embeddings/RAG, mobile, multi-vault editing
- Não planejado: voz (STT/TTS), comparação lado-a-lado de modelos, multi-idioma na UI

---

## 3. Arquitetura

### 3.1 Topologia

```
Obsidian (Electron)
  └─ Plugin openclaude-obsidian (TypeScript, ~2000-3000 loc)
       ├─ Sidebar View (chat + contexto)
       ├─ Modal Hub (Ctrl+K)
       ├─ Diff Preview Modal
       ├─ Results Panel (Dataview Nível 2)
       ├─ Backup History View
       └─ Server Manager (spawn/kill, health check)
         │
         │ HTTP + SSE, localhost:<port>, Bearer token
         ▼
openclaude serve (novo módulo em src/server/, ~500-800 loc)
  ├─ HTTP server (Fastify ou http nativo)
  ├─ SSE stream endpoint
  ├─ Session manager (múltiplas conversas persistidas)
  ├─ Tool executor (reusa tools existentes)
  └─ Vault registry
         │
         ▼
OpenClaude Core (zero mudanças estruturais)
  └─ Agents, Skills, MCP, Tools, Provider adapters
         │
         ▼ filesystem
  Vaults (G:/...)
```

### 3.2 Princípios de design

- **Plugin burro, servidor esperto** — toda lógica de agente no servidor. Plugin é apenas UX.
- **Zero lock-in no plugin** — outros clientes (VS Code, mobile, Telegram) podem implementar a mesma API.
- **Config única** — não duplicamos provider config. Plugin consulta `/models`; trocar modelo chama endpoint que reusa a mesma lógica do `/model` na CLI.
- **Separação por vault** — config do plugin (presets P3, comandos custom) vive em `.openclaude/` dentro de cada vault, versionável.

### 3.3 Reuso total da config OpenClaude

O servidor herda:
- `~/.claude/settings.json` (agent routing, provider config)
- `.env` e `.env.openrouter` do diretório do OpenClaude
- `.openclaude-profile.json` (perfis salvos)

Plugin **nunca duplica** essa config. Mostra estado atual e oferece troca via `/model` / `/provider` delegados.

---

## 4. API de comunicação

Todos os endpoints em `http://127.0.0.1:<port>` com header `Authorization: Bearer <token>`. Bind restrito a loopback. CORS restrito a `app://obsidian.md`.

### 4.1 Endpoints (MVP)

| Método | Path | Descrição |
|---|---|---|
| GET | `/health` | Status, versão, modelo, provider |
| GET | `/config` | Config efetiva (providers, preset P3, vaults) |
| POST | `/config` | Atualiza config do plugin (preset, comandos custom) |
| POST | `/chat` | Envia mensagem. Retorna SSE stream |
| GET | `/sessions` | Lista sessões recentes |
| GET | `/sessions/:id` | Histórico completo da sessão |
| DELETE | `/sessions/:id` | Apaga sessão |
| GET | `/models` | Providers + modelos disponíveis |
| POST | `/models/current` | Troca modelo |
| GET | `/vaults` | Vaults registrados |
| POST | `/vaults` | Registra novo vault |
| DELETE | `/vaults/:id` | Remove do registry |
| GET | `/pending-edits` | Edições aguardando aprovação (P3) |
| POST | `/pending-edits/:id/apply` | Aplica (suporta hunks parciais) |
| POST | `/pending-edits/:id/reject` | Descarta |
| GET | `/backups` | Histórico de snapshots |
| GET | `/backups/:id` | Conteúdo do snapshot |
| POST | `/backups/:id/restore` | Restaura arquivo original |
| POST | `/tools/search` | Busca cross-vault |
| POST | `/tools/dataview` | Gera DQL a partir de linguagem natural (plugin executa localmente via API do Dataview) |
| POST | `/tools/analyze-results` | Recebe resultados resumidos do Dataview + gera insight LLM |
| POST | `/tools/mermaid-graph` | Gera grafo on-demand |

### 4.2 Formato do stream SSE

Eventos tipados JSON por linha:

- `token` — fragmento de texto streamed
- `tool_call` — agente invocando ferramenta (`{name, args, id}`)
- `tool_result` — resultado (`{id, ok, preview}`)
- `pending_edit` — edit aguardando aprovação (`{id, file, hunks, reason}`)
- `insight` — insight do agente para Dataview Nível 2
- `done` — fim (`{sessionId, finishReason, usage}`)
- `error` — erro tipado (`{code, message, retryAfter?}`)

### 4.3 Autenticação (S2 — token automático)

- Startup: gera random 256-bit, escreve em `~/.openclaude/server-token` (mode `0600`)
- Plugin lê mesmo arquivo, envia em Bearer
- Retry 1x em 401 (relê arquivo, caso servidor tenha reiniciado)

### 4.4 Concorrência

- Uma stream ativa por sessão. Segunda mensagem retorna 409 Conflict com opção `{force: true}`
- Cross-vault ops serializadas por path (lock por arquivo)

---

## 5. UX do plugin

### 5.1 Layout escolhido (D — híbrido)

- **Sidebar direita fina (~260px)** sempre visível com: header (status, modelo, config), card de contexto da nota ativa, chat com histórico, input com autocomplete de slash commands
- **Hub modal Ctrl+K** sob demanda: sugestões contextuais + comandos custom + histórico recente
- **Diff preview modal** centralizado quando agente quer editar
- **Results panel** automático pra Dataview Nível 2
- **Backup history view** via Ctrl+K → "Histórico do agente"

### 5.2 Atalhos padrão

| Atalho | Ação |
|---|---|
| `Ctrl+K` | Abre hub modal |
| `Ctrl+Shift+O` | Foca input da sidebar |
| `Ctrl+Shift+A` | Resumir nota ativa |
| `Ctrl+Shift+Z` | Expandir seleção em Zettels |
| `Ctrl+Shift+B` | Abrir Backup History |
| `Esc` (durante stream) | Cancela resposta |

Todos customizáveis via Obsidian Settings → Hotkeys.

### 5.3 Estados visuais

- Servidor OK: dot verde
- Servidor iniciando: dot amarelo piscante, input desabilitado
- Servidor caído: dot vermelho + banner "Reiniciar"
- Streaming: dot verde pulsante, botão vira "■ Parar"
- Pending edit: badge vermelho com contador
- Rate limit: toast com retry
- Offline cloud: banner "Modo local apenas"

### 5.4 Diff preview modal

- Side-by-side ANTES/DEPOIS com hunks em verde/vermelho
- Botões: Descartar / Aplicar parcial (checkbox por hunk) / Aplicar (Enter)
- Confirmação "shadow backup criado ✓" no rodapé
- Esc = descartar; pending edits não decididas persistem 24h

---

## 6. Features detalhadas

### 6.1 Chat com contexto da nota ativa

- Contexto injetado automático: frontmatter + primeiras 200 linhas + título da nota ativa
- Seleção de texto envia como `context.selection` (prioridade)
- Histórico persistido em `~/.openclaude/sessions/<id>.jsonl`
- Card de contexto atualiza via `workspace.on('active-leaf-change')`

### 6.2 Busca cross-vault

- Vaults configurados em `~/.openclaude/vaults.yml`
- Agente roda `Grep` nos vaults selecionados, retorna até 10 resultados agrupados
- Links são wikilinks clicáveis (vault atual) ou badge `[VaultName]` + URI `obsidian://open` (outros vaults)
- Fallback com sugestão semântica em resultados escassos

### 6.3 Dataview Nível 1+2

**Fluxo em 3 passos (divisão de responsabilidade clara):**

1. **Servidor** recebe `POST /tools/dataview` com linguagem natural → LLM gera DQL + explicação, retorna ao plugin
2. **Plugin** executa DQL localmente via `app.plugins.plugins.dataview.api.query(...)` (Dataview só expõe API dentro do Obsidian)
3. **Plugin** envia resultados resumidos via `POST /tools/analyze-results` → servidor LLM gera insight, streamado de volta

**Nível 1** — plugin mostra DQL gerado numa dropdown "Ver query" + botão "Copiar como bloco Dataview" (cola em nota como ` ```dataview ... ``` `).

**Nível 2** — plugin renderiza resultados no painel com:
- Chips de filtros clicáveis
- Busca full-text na tabela
- Toggle Tabela/Barra/Pizza/Linha (Chart.js ~70kb lazy-loaded)
- Insight do agente no rodapé (vindo do passo 3)
- Botões "Copiar DQL" / "Exportar CSV"

**Erro/edge:**
- Query inválida: servidor tenta corrigir 1x automático
- Resultado vazio: plugin sugere ajuste de filtros
- Dataview não instalado: plugin detecta e oferece instalar antes

### 6.4 Mermaid graph on-demand

- Até 50 nós, profundidade 3 (configurável)
- Tipos de link: wikilinks, embeds, links no frontmatter
- Output em `graph LR` ou `graph TD`, Obsidian renderiza nativo
- Plugin tem fallback render via mermaid.js (~300kb lazy-loaded)

### 6.5 Slash commands customizáveis

- Arquivo `.openclaude/commands.yml` no root do vault
- Campos: `id`, `name`, `description`, `prompt` (com template vars), `shortcuts`, `scope`, `applyMode`
- Template vars: `{{date:YYYY-MM-DD}}`, `{{slug}}`, `{{selection}}`, `{{activeNote}}`
- `applyMode`: `preview-diff` / `append-to-note` / `create-new-note` / `chat-only`
- Autocomplete no chat via `/`, listado no Ctrl+K

### 6.6 Shadow backup

- Antes de todo `Edit`/`Write`, copia original pra `.openclaude-backups/YYYY-MM-DD_HHMM-<hash8>-<slug>.md`
- Metadata em `.openclaude-backups/index.json`
- Auto-adicionado ao `.gitignore` se vault tiver git
- Job semanal limpa > 30 dias (configurável)
- Restore 1-clique no Backup History view

### 6.7 Health check

Painel "Diagnóstico" com checklist:
- Servidor rodando
- Token válido
- Provider respondendo
- Ollama rodando (se aplicável)
- Pasta backup writable
- Obsidian File Recovery habilitado
- Vaults registrados acessíveis
- `commands.yml` válido

Ação corretiva 1-clique em cada. Health check auto a cada 5min.

---

## 7. Permission model (P3 detalhado)

### 7.1 Config

`.openclaude/permissions.yml` por vault define preset ou regras custom. Suporta overrides por path (glob), batch threshold, runtime unlock.

### 7.2 Presets

- **conservador** — tudo preview-diff, delete com confirmação de nome, bash bloqueado
- **balanceado** (default) — read/create auto; edit preview-diff; daily notes append-only auto; delete/bash ask-confirmation; folders sensíveis ask-confirmation
- **agressivo** — tudo auto exceto delete e bash destrutivo; `99-Sistema` ainda pede

### 7.3 Batch handling

- 3+ edits encadeados: modal bulk com checkbox por edit
- 10+ edits: modo batch com preview um-a-um + aprovação em massa
- `/trust 5min` libera preset agressivo em memória (não persiste)

### 7.4 Tripwires (não bypassáveis)

- `rm -rf` em pasta raiz do vault
- Git commit/push com credenciais
- Modificação de `.openclaude/permissions.yml` ou `~/.claude/settings.json`
- Envio de conteúdo pra URL externa (exceto via MCP/WebFetch aprovado)

### 7.5 Audit trail

Toda ação logada em `.openclaude/audit.log` (JSONL) com timestamp, sessão, ação, arquivo, status, motivo.

---

## 8. Erros, offline e edge cases

### 8.1 Falhas de processo

- Servidor crash: plugin detecta via timeout SSE, mostra "Reiniciando...", respawn automático, oferece retomar última mensagem. Histórico e pending edits persistem em disco.
- Stream cancelado pelo usuário: DELETE /sessions/:id/stream, marca como `[cancelada]`, pending edits anteriores ficam válidas.

### 8.2 Falhas de provider

Mapa de resposta por tipo:
- Rate limit: retry exponencial max 3x/2min
- Timeout >120s: cancela, sugere trocar modelo
- Auth inválido: modal para reconfigurar
- Modelo não existe: sugere alternativas
- Ollama down: tenta iniciar 1x automático
- Network: retry 3x a cada 10s
- Fallback chain opcional (desabilitado por default)

### 8.3 Filesystem

- Vault desapareceu (G:/ desmontou): `VAULT_UNAVAILABLE` + re-register UI
- Encoding: UTF-8 → UTF-16 → latin-1 fallback
- Disco cheio: bloqueia edits + oferece limpeza de backups
- Permissão negada: modal "Desbloquear arquivo"

### 8.4 Conflito de edição

- Plugin mantém hash MD5 do contexto enviado
- Antes de aplicar diff, compara com hash atual
- Sem conflito: aplica; fora da região: aplica + avisa; mesmo local: modal de conflito com opções

### 8.5 Multi-instância

- Servidor único pra todo o sistema
- Cada janela do Obsidian = sessão própria
- Lock por path pra edits simultâneas

### 8.6 Versioning plugin ↔ servidor

- Plugin compara `/health.version` com sua versão
- Major diferente: bloqueia com guia de update
- Minor/patch: aviso suave, graceful degradation

---

## 9. Estratégia de testes

### 9.1 Três camadas

- **Unit** (<10s, cada save): Vitest/Bun test, funções puras, parsers, validators, diff generation. Meta 80% em módulos críticos.
- **Integration** (30-60s, cada PR): servidor real + LLM mock + vault fake. Testa endpoints end-to-end, fixtures pré-gravadas pras respostas LLM.
- **E2E smoke** (2-3min, semanal): Playwright + Electron + Ollama local com modelo rápido. 3-5 cenários críticos.

### 9.2 Mock da API Obsidian

Plugin recebe `app` via DI, permitindo mockar `vault.read/modify/create` + `workspace.on` sem Obsidian real.

### 9.3 Segurança = prioridade máxima

Suite `tests/security/` roda primeiro no CI (fail fast):
- Tripwires
- Path traversal (agente não escapa do vault)
- Token auth em todo endpoint
- CORS restrito
- Rate limit enforcement
- Backup precede edit sempre

### 9.4 CI

GitHub Actions: security → unit → integration → lint/types. E2E semanal separado. Tempo PR: 3-5min.

---

## 10. Instalação e onboarding

### 10.1 CLI unificada

```bash
openclaude obsidian install
```

Ações automáticas:
- Detecta vaults via registro do Obsidian
- Oferece quais registrar
- Copia plugin pra `.obsidian/plugins/openclaude-obsidian/` de cada
- Cria `.openclaude/config.yml` com preset default
- Gera token em `~/.openclaude/server-token`
- Cria `.openclaude-backups/` + adiciona ao `.gitignore`
- Configura startup automático do servidor (Windows Registry Run / macOS LaunchAgent)
- Verifica Ollama rodando
- Health check final

**Limite inerente do Obsidian:** ativação manual do plugin na primeira vez (proteção anti-malware). Documentado no fluxo.

### 10.2 Atualização

- Plugin: via Community Plugins (se publicado) ou canal custom
- Servidor: `openclaude update`
- Config migrations automáticas

---

## 11. Requisitos não-funcionais

- Tempo de startup do servidor: < 3s
- Latência do primeiro token (depois do request): dependente do provider (Ollama cloud ~1s, OpenAI ~0.5s)
- Memória do servidor em idle: < 150MB
- Memória do plugin: < 80MB
- Tamanho do plugin instalado: < 5MB (lazy-load de mermaid/chart.js)
- Vault com até 10.000 notas: busca < 2s, grafo < 1s

---

## 12. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Obsidian muda API da comunidade | Média | Wrapper interno, testes de integração contra versões |
| Provider LLM fica instável | Alta | Fallback chain opcional + UX clara de erro |
| Corrupção de arquivo via bug no Edit | Baixa | Shadow backup obrigatório + testes de segurança |
| Conflito de arquivo com Obsidian aberto | Média | Hash check antes de aplicar + modal de conflito |
| Plugin muito pesado pro Obsidian | Baixa | Lazy-load bibliotecas grandes + monitoring |
| Servidor vaza dados (bind em 0.0.0.0) | Baixa | Bind obrigatório 127.0.0.1 + teste de segurança |

---

## 13. Cronograma estimado

MVP completo: **3-4 semanas** de trabalho focado + validação diária do usuário (10-20min/dia).

Fases sugeridas (detalhar no plano de implementação):
1. **Semana 1:** servidor HTTP + endpoints core + testes de segurança
2. **Semana 2:** plugin esqueleto (sidebar + chat) + integração servidor
3. **Semana 3:** features (Dataview, Mermaid, slash commands, Ctrl+K)
4. **Semana 4:** permission model completo + backup + health check + CLI install + polimento

---

## 14. Métricas de sucesso

- Usuário consegue completar 5 fluxos comuns sem ler docs: busca, resumir, expandir, gerar Dataview, restaurar backup
- Zero edição não autorizada em `99-Sistema` ou `07-Arquivo` nos primeiros 30 dias de uso
- 100% das edições têm shadow backup correspondente
- Health check verde em instalação fresh
- Nenhum crash do Obsidian causado pelo plugin

---

## 15. Questões em aberto

1. **Nome do projeto:** `openclaude-obsidian` vs `Sinapse` vs `Neurônio` vs `Hippocampus` — decisão pré-implementação
2. **Distribuição:** submeter ao Obsidian Community Plugins ou distribuir via GitHub Releases? (afeta processo de update)
3. **Telemetria opt-in:** log local é suficiente ou vale telemetria agregada pra debug?
4. **Testar com vault real do usuário:** Energinova_Hub é o melhor candidato pra beta privado?
5. **Integração com plugin Dataview:** assumir instalado ou detectar e oferecer install?
6. **Registrar os 6+ vaults do usuário no install default** ou deixar opt-in por vault?

---

## 16. Decisões tomadas no brainstorming (registro)

- **Arquitetura:** plugin Obsidian + servidor HTTP local (A2)
- **Layout:** híbrido sidebar + Ctrl+K (D)
- **Permissão:** P3 preset balanceado default
- **Servidor:** auto-iniciado pelo plugin (L2), token automático (S2), bind 127.0.0.1
- **Config:** reuso total do OpenClaude + per-vault em `.openclaude/`
- **Backup:** shadow automático pré-edit, retenção 30 dias
- **Dataview:** Nível 1 + Nível 2 no MVP; Níveis 3+4 para depois
- **Multi-vault:** cross-vault search no MVP; editing cross-vault para v2
- **Grafo:** Mermaid on-demand no MVP; interativo full-featured para v2
- **Git nos vaults:** não requerido (usuário não tem), substituído por shadow backup próprio

---

## 17. Referências

- OpenClaude project: `e:/Agente_OpenClaude_Segundo_cérebro/`
- Vaults do usuário: `g:/Meu Drive/Estratégia Energinova 2026/Energinova_Hub/` e variações PARA em FinPower, SigBlock, Power_Project, Propostas_3.0
- Obsidian Plugin API: https://docs.obsidian.md/Home
- Dataview API: https://blacksmithgu.github.io/obsidian-dataview/
- Mermaid.js: https://mermaid.js.org/
- OpenClaude settings reference: `~/.claude/settings.json`, `.env`, `.openclaude-profile.json`
