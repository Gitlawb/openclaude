# Ferramentas e Performance: Claude Code v2.1.88 → v2.1.119

**Período:** 31 de março a 24 de abril de 2026  
**Gap de versões:** 31 versões  
**Base do OpenClaude:** v2.1.88 (leaked 31/03/2026)

---

## 🛠️ Novas Ferramentas

### 1. Monitor Tool (v2.1.98)
**Descrição:** Spawna watcher em background e stream eventos linha-por-linha para conversa. Cada evento vira mensagem no transcript que Claude reage imediatamente.

**API:**
```typescript
interface MonitorParams {
  command: string;      // Comando shell para monitorar
  description: string;  // Descrição do que está sendo monitorado
}
// Retorna task_id, stream eventos como notificações
```

**Casos de uso:**
- Tail de logs de treinamento
- Babysit CI de PR
- Auto-fix crash de dev server no momento que acontece
- Elimina necessidade de Bash sleep loops

**Implementação:** Nova tool que spawna background process, stream stdout lines como `<task-notification>`

**Prioridade:** 🔴 CRÍTICA - Melhora significativa de UX para workflows longos

---

### 2. PowerShell Tool (v2.1.84, rollout v2.1.111, v2.1.120)
**Descrição:** Tool nativa para Windows PowerShell, alternativa ao Bash no Windows.

**Evolução:**
- **v2.1.84:** Opt-in preview via flag
- **v2.1.111:** Rollout gradual começou
- **v2.1.120:** Git Bash não é mais required no Windows, PowerShell é default

**Features:**
- Auto-approval para comandos read-only
- Hardened permission checks (trailing `&` bypass, `-ErrorAction Break` hang, archive-extraction TOCTOU)
- Version-appropriate syntax guidance (5.1 vs 7+)
- Dangerous command detection melhorado

**Segurança:**
- v2.1.119: PowerShell auto-approval habilitado
- v2.1.97: Hardened checks para env-var prefixes e network redirects
- v2.1.90: Trailing `&` background job bypass fixado
- v2.1.89: Improved dangerous command detection

**Prioridade:** 🟡 MÉDIA - Específico para Windows, OpenClaude já tem Bash

---

### 3. Ultraplan (Week 15, Research Preview)
**Descrição:** Kickoff plan mode na cloud do terminal, review resultado no browser. Claude drafta plano em sessão web enquanto terminal fica livre.

**Comando:**
```bash
/ultraplan migrate the auth service from sessions to JWTs
```

**Features:**
- Auto-cria default cloud environment no primeiro run
- Comenta seções individuais
- Pede revisões
- Escolhe executar remotamente ou enviar de volta ao CLI

**Prioridade:** 🔵 N/A - Requer cloud infrastructure (não aplicável ao OpenClaude)

---

### 4. Ultrareview (v2.1.111, Week 17)
**Descrição:** Fleet de bug-hunting agents na cloud contra branch ou PR. Findings voltam ao CLI/Desktop automaticamente.

**Comandos:**
```bash
/ultrareview           # review branch atual
/ultrareview 1234      # review PR específico
```

**Features:**
- Roda reviewers paralelos na cloud
- Passa adversarial critique sobre cada finding
- Retorna verified findings report
- Terminal fica livre durante review

**Prioridade:** 🔵 N/A - Requer cloud infrastructure (não aplicável ao OpenClaude)

---

### 5. Routines (Week 16)
**Descrição:** Templated cloud agents que disparam em schedule, GitHub event, ou API call.

**Comando:**
```bash
/schedule daily PR review at 9am
```

**Features:**
- Define routine uma vez na web com prompt, repos, connectors
- Triggers: PR-opened, release-published, webhook
- Cada routine tem endpoint `/fire` tokenizado

**Prioridade:** 🔵 N/A - Requer cloud infrastructure (não aplicável ao OpenClaude)

---

## ⚡ Melhorias de Performance

### Startup Performance

#### v2.1.84 (25/03/2026)
- **30ms faster startup:** `setup()` roda em paralelo com slash command e agent loading
- **Immediate REPL render:** Com MCP servers, REPL renderiza imediatamente ao invés de bloquear até servers conectarem
- **Partial clone fix:** Repositories Scalar/GVFS não triggam mais mass blob downloads no startup

#### v2.1.86 (27/03/2026)
- **Reduced event-loop stalls:** Quando muitos claude.ai MCP connectors configurados (macOS keychain cache extended de 5s para 30s)

#### v2.1.89 (01/04/2026)
- **MCP connection optimization:** `MCP_CONNECTION_NONBLOCKING=true` para `-p` mode skip MCP connection wait, bounded `--mcp-config` server connections em 5s

#### v2.1.94 (07/04/2026)
- **[VSCode] Reduced cold-open work:** Menos subprocess work ao iniciar sessão

#### v2.1.97 (08/04/2026)
- **Faster startup:** Eliminado per-turn JSON.stringify de MCP tool schemas em cache-key lookup

---

### Memory & Resource Management

#### v2.1.86 (27/03/2026)
- **Memory growth fix:** Long sessions não retêm mais full content strings em markdown/highlight render caches

#### v2.1.89 (01/04/2026)
- **Memory leak fix:** Large JSON inputs não são mais retained como LRU cache keys em long-running sessions
- **Transcript size optimization:** Skipping empty hook entries e capping stored pre-edit file copies

#### v2.1.97 (08/04/2026)
- **Memory leak fix:** Remote Control permission handler entries não são mais retained por lifetime da sessão
- **NO_FLICKER memory leak fix:** API retries não deixam mais stale streaming state

#### v2.1.98 (09/04/2026)
- **Memory leak fix:** Remote Control permission handler entries fixado novamente

#### v2.1.100 (09/04/2026)
- **Multi-GB RSS fix:** Memory leak em sessions longas causando multi-GB RSS usage
- **Virtual scroller leak:** Long sessions retinham dozens de historical copies da message list

---

### Diff & File Operations

#### v2.1.83 (25/03/2026)
- **Diff timeout:** Diffs em very large files com few common lines agora timeout após 5s e fallback gracefully

#### v2.1.91 (02/04/2026)
- **Edit tool optimization:** Usa shorter `old_string` anchors, reduzindo output tokens

#### v2.1.92 (04/04/2026)
- **Write tool diff speed:** 60% faster em files com tabs/`&`/`$`

---

### Rendering & UI Performance

#### v2.1.84 (25/03/2026)
- **Reduced UI stutter:** Quando compaction triggers em large sessions

#### v2.1.85 (26/03/2026)
- **Scroll performance:** Replaced WASM yoga-layout com pure TypeScript implementation para large transcripts

#### v2.1.90 (01/04/2026)
- **SSE transport:** Handles large streamed frames em linear time (era quadratic)
- **SDK sessions:** Long conversations não slow down quadratically em transcript writes

#### v2.1.97 (08/04/2026)
- **Reduced terminal flickering:** Quando animated tool progress scrolla acima do viewport
- **Reduced scroll-to-top resets:** Message window immune a compaction e grouping changes

---

### Network & API Performance

#### v2.1.85 (26/03/2026)
- **ECONNRESET fix:** Persistent errors durante edge connection churn fixados usando fresh TCP connection em retry

#### v2.1.91 (02/04/2026)
- **Bun optimization:** Faster `stripAnsi` routing através de `Bun.stripANSI`

#### v2.1.98 (09/04/2026)
- **429 retry fix:** Exponential backoff agora aplica como minimum quando server retorna small `Retry-After`

---

### Resume & Session Management

#### v2.1.90 (01/04/2026)
- **Parallel loading:** `/resume` all-projects view carrega project sessions em parallel

#### v2.1.116 (Week 17)
- **67% faster `/resume`:** Large sessions até 67% mais rápidas
- **Stale session handling:** Oferece summarizar stale, large sessions antes de re-ler

---

### Token & Context Optimization

#### v2.1.86 (27/03/2026)
- **Read tool optimization:** Compact line-number format e deduplicates unchanged re-reads
- **@-mention optimization:** Raw string content não é mais JSON-escaped
- **Skill descriptions:** Capped em 250 characters para reduzir context usage
- **Prompt cache hit rate:** Improved para Bedrock, Vertex, Foundry removendo dynamic content de tool descriptions

#### v2.1.89 (01/04/2026)
- **Hook output optimization:** Output over 50K characters saved to disk com file path + preview ao invés de injected directly em context
- **Nested CLAUDE.md fix:** Não são mais re-injected dozens de times em long sessions

#### v2.1.91 (02/04/2026)
- **Edit tool optimization:** Shorter `old_string` anchors reduzem output tokens

#### v2.1.98 (09/04/2026)
- **MCP tool descriptions:** Capped em 2KB para prevenir OpenAPI-generated servers de bloating context

#### v2.1.117 (Week 17)
- **Context window fix:** Opus 4.7 sessions computam contra native 1M context window, fixando inflated `/context` percentages e premature autocompaction

---

### Search & Autocomplete Performance

#### v2.1.85 (26/03/2026)
- **@-mention autocomplete:** Improved performance em large repositories

#### v2.1.117 (Week 17)
- **Embedded search tools:** Native macOS/Linux builds substituem `Glob` e `Grep` tools com `bfs` e `ugrep` embedded, buscas mais rápidas sem round-trip de tool separada

---

### Hook Performance

#### v2.1.85 (26/03/2026)
- **Conditional hooks:** `if` field usando permission rule syntax (e.g., `Bash(git *)`) filtra quando rodam, reduzindo process spawning overhead

#### v2.1.97 (08/04/2026)
- **MCP tool hooks:** Hooks podem chamar MCP tools diretamente via `type: "mcp_tool"`, sem spawnar processo

---

## 🔒 Melhorias de Segurança

### Hardened Bash Permissions

#### v2.1.92 (04/04/2026)
- **Baseline hardening:** Deny rules agora matcham através de `env`/`sudo`/`watch` wrappers
- **`find` hardening:** `Bash(find:*)` allow rules não auto-aprovam `-exec` ou `-delete`

#### v2.1.97 (08/04/2026)
- **Comprehensive hardening:**
  - Backslash-escaped flags
  - Env-var prefixes
  - `/dev/tcp` redirects
  - Compound commands agora promptam corretamente

#### v2.1.98 (09/04/2026)
- **Permission bypass fix:** Backslash-escaped flag podia ser auto-allowed como read-only e lead a arbitrary code execution
- **Compound command fix:** Bypassing forced permission prompts para safety checks
- **Env-var prefix fix:** Read-only commands com env-var prefixes não promptavam a menos que var fosse known-safe
- **Network redirect fix:** Redirects para `/dev/tcp/...` ou `/dev/udp/...` não promptavam

#### v2.1.100 (09/04/2026)
- **Command injection fix:** Vulnerability em POSIX `which` fallback usado por LSP binary detection

**Casos cobertos:**
```bash
# Deve detectar e prompt:
env bash -c "rm -rf /"
sudo rm -rf /
watch -n 1 "curl evil.com"
find . -exec rm {} \;
find . -delete

# Deve permitir com allow rule:
find . -name "*.js"
find . -type f
```

**Prioridade:** 🔴 CRÍTICA - Segurança fundamental

---

### Subprocess Sandboxing

#### v2.1.98 (09/04/2026)
- **PID namespace isolation:** Linux quando `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` set
- **Script caps:** `CLAUDE_CODE_SCRIPT_CAPS` env var limita per-session script invocations

#### v2.1.83 (25/03/2026)
- **Env scrubbing:** `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strip Anthropic e cloud provider credentials de subprocess environments

---

## 🎨 UX Improvements

### Session Management

#### v2.1.108 (Week 17) - Session Recap
**Descrição:** Ao voltar para sessão, mostra resumo de 1 linha do que aconteceu enquanto estava fora.

**Comandos:**
- `/recap` - gera recap on-demand
- `/config` - toggle automático

**Prioridade:** 🟡 MÉDIA - Nice to have para power users

---

### Settings Persistence (v2.1.119, Week 17)
**Descrição:** `/config` changes (theme, editor mode, verbose, etc) agora persistem para `~/.claude/settings.json`.

**Prioridade:** 🟡 MÉDIA - Melhora UX

---

### Custom Themes (v2.1.118, Week 17)
**Descrição:** Build e switch entre temas de cor nomeados via `/theme`, ou edita JSON em `~/.claude/themes/`.

**Features:**
- Cada tema escolhe preset base e override apenas tokens desejados
- Plugins podem shippar temas
- Opção "Auto (match terminal)" segue dark/light do terminal

**Prioridade:** 🟢 BAIXA - Cosmético

---

### Vim Visual Mode (v2.1.118, Week 17)
**Descrição:** Press `v` para character selection ou `V` para line selection no prompt input, com operators e visual feedback.

**Prioridade:** 🟢 BAIXA - Nice to have para vim users

---

### Focus View (v2.1.97, Week 15)
**Descrição:** Press `Ctrl+O` em flicker-free mode para colapsar view para: último prompt, one-line tool summary com diffstats, resposta final de Claude.

**Prioridade:** 🟢 BAIXA - UX improvement

---

### Team Onboarding (v2.1.101)
**Descrição:** `/team-onboarding` gera guia de ramp-up de teammate do uso local do Claude Code.

**Workflow:**
1. Run em projeto que você conhece bem
2. Passa output para novo teammate
3. Teammate replaya seu setup ao invés de começar do zero

**Prioridade:** 🟡 MÉDIA - Útil para onboarding de equipes

---

### Usage Breakdown (Week 16)
**Descrição:** `/usage` mostra o que está driving limits: parallel sessions, subagents, cache misses, long context.

**Features:**
- Cada item com % das últimas 24h
- Tip para otimizar
- Press `d` ou `w` para switch entre day/week views
- Merge de `/cost` e `/stats` em `/usage`

**Prioridade:** 🟡 MÉDIA - OpenClaude já tem `/usage` mas pode melhorar breakdown

---

### Fewer Permission Prompts (Week 16)
**Descrição:** `/fewer-permission-prompts` scannea transcripts para common read-only Bash e MCP calls e propõe allowlist para `.claude/settings.json`.

**Prioridade:** 🟡 MÉDIA - Reduz friction

---

### TUI Toggle (Week 16)
**Descrição:** `/tui` command e `tui` setting switcham entre classic e flicker-free rendering mid-conversation.

**Prioridade:** 🟢 BAIXA - UX preference

---

### Command Aliases (Week 16)
- `/undo` é alias para `/rewind`
- `/proactive` é alias para `/loop`

**Prioridade:** 🟢 BAIXA - Convenience

---

## 🔧 Advanced Features

### Forked Subagents (v2.1.117, Week 17)
**Descrição:** Forked subagents podem ser habilitados com `CLAUDE_CODE_FORK_SUBAGENT=1`. Fork herda full conversation context ao invés de começar fresh.

**Prioridade:** 🟡 MÉDIA - Melhora context preservation

---

### MCP Tool Hooks (v2.1.118, Week 17)
**Descrição:** Hooks podem chamar MCP tools diretamente via `type: "mcp_tool"`, sem spawnar processo.

**Prioridade:** 🟡 MÉDIA - Melhora performance de hooks

---

### GitLab/Bitbucket Support (v2.1.119, Week 17)
**Descrição:** `--from-pr` agora aceita GitLab merge request, Bitbucket pull request, e GitHub Enterprise PR URLs além de github.com.

**Prioridade:** 🟡 MÉDIA - Expande compatibilidade

---

### Auto Mode Improvements (Week 16-17)
- Auto mode disponível para Max subscribers no Opus 4.7
- Flag `--enable-auto-mode` não é mais necessário
- Include `"$defaults"` em `autoMode.allow`, `soft_deny`, ou `environment` para adicionar regras custom junto com built-in list

**Prioridade:** 🟡 MÉDIA - Melhora UX de auto mode

---

### PreCompact Hooks (Week 16)
**Descrição:** `PreCompact` hooks podem bloquear compaction exitando com code 2 ou retornando `{"decision":"block"}`.

**Prioridade:** 🟢 BAIXA - Edge case

---

### Plugin Monitors (Week 16)
**Descrição:** Plugins podem shippar background watchers via top-level `monitors` manifest key que auto-arms no session start ou skill invoke.

**Prioridade:** 🟢 BAIXA - Plugin ecosystem

---

### Plugin Tag Command (Week 17)
**Descrição:** `claude plugin tag` cria release git tags para plugins com version validation.

**Prioridade:** 🟢 BAIXA - Plugin ecosystem

---

### Push Notifications (Week 16)
**Descrição:** Com Remote Control conectado e "Push when Claude decides" habilitado, Claude pode pingar phone quando precisa de você.

**Prioridade:** 🟢 BAIXA - Requer mobile app

---

### Sandbox Network Denied Domains (Week 16)
**Descrição:** `sandbox.network.deniedDomains` setting carve specific domains out de broader `allowedDomains` wildcard.

**Prioridade:** 🟢 BAIXA - Security edge case

---

### Prompt Caching 1H TTL (Week 16)
**Descrição:** `ENABLE_PROMPT_CACHING_1H` opta API key, Bedrock, Vertex, e Foundry users em 1-hour prompt cache TTL.

**Prioridade:** 🟢 BAIXA - API-specific

---

### Perforce Mode (Week 15)
**Descrição:** `CLAUDE_CODE_PERFORCE_MODE`: Edit/Write fail em read-only files com `p4 edit` hint ao invés de silently overwrite.

**Prioridade:** 🟢 BAIXA - Niche use case

---

## 📊 Resumo Quantitativo

### Novas Ferramentas
- **5 ferramentas principais:** Monitor, PowerShell, Ultraplan, Ultrareview, Routines
- **2 aplicáveis ao OpenClaude:** Monitor (crítica), PowerShell (média)
- **3 requerem cloud:** Ultraplan, Ultrareview, Routines

### Melhorias de Performance
- **Startup:** 4 otimizações principais (30ms faster, immediate REPL, parallel loading, MCP optimization)
- **Memory:** 6 memory leaks fixados (multi-GB RSS, virtual scroller, LRU cache, render caches, Remote Control, NO_FLICKER)
- **Diff/Files:** 3 otimizações (60% faster Write diff, timeout handling, shorter anchors)
- **Rendering:** 5 melhorias (scroll performance, UI stutter, flickering, scroll-to-top resets, linear SSE)
- **Network:** 2 otimizações (ECONNRESET fix, 429 retry backoff)
- **Resume:** 67% faster em large sessions
- **Token/Context:** 10+ otimizações (Read tool, @-mention, skill descriptions, MCP caps, nested CLAUDE.md, context window fix)
- **Search:** 2 melhorias (@-mention autocomplete, embedded bfs/ugrep)
- **Hooks:** 2 otimizações (conditional hooks, MCP tool hooks)

### Segurança
- **Hardened Bash:** 4 versões de melhorias incrementais (v2.1.92, v2.1.97, v2.1.98, v2.1.100)
- **Subprocess Sandboxing:** PID namespace isolation, script caps, env scrubbing
- **Command injection:** 1 vulnerability crítica fixada

### UX Features
- **8 features principais:** Session Recap, Settings Persistence, Custom Themes, Vim Visual Mode, Focus View, Team Onboarding, Usage Breakdown, Fewer Permission Prompts
- **3 features menores:** TUI Toggle, Command Aliases, Push Notifications

### Advanced Features
- **9 features avançadas:** Forked Subagents, MCP Tool Hooks, GitLab/Bitbucket Support, Auto Mode Improvements, PreCompact Hooks, Plugin Monitors, Plugin Tag Command, Sandbox Network Denied Domains, Prompt Caching 1H TTL, Perforce Mode

---

## 🎯 Prioridades para OpenClaude

### 🔴 CRÍTICAS (Implementar primeiro)
1. **Monitor Tool** - Melhora significativa de UX para workflows longos
2. **Hardened Bash Permissions** - Segurança fundamental (4 versões de melhorias)
3. **Memory Leaks** - 6 leaks críticos fixados (multi-GB RSS, virtual scroller, etc)

### 🟡 MÉDIAS (Implementar depois)
1. **PowerShell Tool** - Específico para Windows
2. **Session Recap** - Nice to have para power users
3. **Usage Breakdown** - Melhorar breakdown existente
4. **Team Onboarding** - Útil para onboarding
5. **MCP Tool Hooks** - Performance de hooks
6. **Forked Subagents** - Context preservation
7. **GitLab/Bitbucket Support** - Compatibilidade
8. **Settings Persistence** - UX
9. **Fewer Permission Prompts** - Reduz friction
10. **Auto Mode Improvements** - Melhora UX
11. **Resume Optimization** - 67% faster
12. **Token/Context Optimizations** - 10+ melhorias

### 🟢 BAIXAS (Nice to have)
- Custom Themes
- Vim Visual Mode
- Focus View
- Plugin Monitors
- Plugin Tag Command
- Push Notifications
- TUI Toggle
- Sandbox Network Denied Domains
- Command Aliases
- Prompt Caching 1H TTL
- Perforce Mode
- PreCompact Hooks

### 🔵 N/A (Não aplicável)
- Ultraplan (cloud)
- Ultrareview (cloud)
- Routines (cloud)

---

## 📈 Performance Gains Summary

| Categoria | Melhoria | Versão |
|-----------|----------|--------|
| Startup | 30ms faster | v2.1.84 |
| Resume | 67% faster | v2.1.116 |
| Write diff | 60% faster | v2.1.92 |
| Memory | Multi-GB RSS leak fixado | v2.1.100 |
| Rendering | Quadratic → Linear (SSE) | v2.1.90 |
| Scroll | WASM → TypeScript | v2.1.85 |
| Search | Embedded bfs/ugrep | v2.1.117 |

---

## 🔗 Fontes

- [Week 15 · April 6–10, 2026](https://code.claude.com/docs/en/whats-new/2026-w15)
- [Week 16 · April 13–17, 2026](https://code.claude.com/docs/en/whats-new/2026-w16)
- [Week 17 · April 20–24, 2026](https://code.claude.com/docs/en/whats-new/2026-w17)
- Changelog completo: v2.1.92 → v2.1.126
