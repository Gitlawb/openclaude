# Features do Claude Code para Portar ao OpenClaude

**Data de análise:** 2026-05-03  
**Versões analisadas:** v2.1.92 → v2.1.119 (Semanas 15-17, Abril 2026)

---

## 🎯 Features Prioritárias

### 1. **Monitor Tool** (v2.1.98)
**Status:** Não existe no OpenClaude  
**Descrição:** Tool que spawna watcher em background e stream eventos para a conversa. Cada evento vira mensagem no transcript que Claude reage imediatamente.

**Casos de uso:**
- Tail de logs de treinamento
- Babysit CI de PR
- Auto-fix crash de dev server no momento que acontece
- Elimina necessidade de Bash sleep loops

**Implementação sugerida:**
```typescript
// Nova tool: Monitor
interface MonitorParams {
  command: string;
  description: string;
}

// Retorna task_id, stream eventos como notificações
```

**Prioridade:** 🔴 ALTA - Melhora significativa de UX para workflows longos

---

### 2. **Session Recap** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Ao voltar para sessão, mostra resumo de 1 linha do que aconteceu enquanto estava fora.

**Casos de uso:**
- Múltiplas sessões Claude rodando
- Manter flow ao alternar entre sessões

**Comandos:**
- `/recap` - gera recap on-demand
- `/config` - toggle automático

**Prioridade:** 🟡 MÉDIA - Nice to have para power users

---

### 3. **Custom Themes** (v2.1.118)
**Status:** Não existe no OpenClaude  
**Descrição:** Build e switch entre temas de cor nomeados via `/theme`, ou edita JSON em `~/.claude/themes/`.

**Features:**
- Cada tema escolhe preset base e override apenas tokens desejados
- Plugins podem shippar temas
- Opção "Auto (match terminal)" segue dark/light do terminal

**Prioridade:** 🟢 BAIXA - Cosmético, não afeta funcionalidade core

---

### 4. **Ultraplan** (Research Preview, Week 15)
**Status:** Não existe no OpenClaude  
**Descrição:** Kickoff plan mode na cloud do terminal, review resultado no browser. Claude drafta plano em sessão web enquanto terminal fica livre.

**Features:**
- Auto-cria default cloud environment no primeiro run
- Comenta seções individuais
- Pede revisões
- Escolhe executar remotamente ou enviar de volta ao CLI

**Comando:**
```bash
/ultraplan migrate the auth service from sessions to JWTs
```

**Prioridade:** 🔴 ALTA - Mas requer infraestrutura cloud (não aplicável ao OpenClaude open-source)

---

### 5. **Ultrareview** (Research Preview, Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Fleet de bug-hunting agents na cloud contra branch ou PR. Findings voltam ao CLI/Desktop automaticamente.

**Features:**
- Roda reviewers paralelos na cloud
- Passa adversarial critique sobre cada finding
- Retorna verified findings report
- Terminal fica livre durante review

**Comandos:**
```bash
/ultrareview           # review branch atual
/ultrareview 1234      # review PR específico
```

**Prioridade:** 🔴 ALTA - Mas requer infraestrutura cloud (não aplicável ao OpenClaude open-source)

---

### 6. **Auto-fix PR** (Week 15)
**Status:** Não existe no OpenClaude  
**Descrição:** `/autofix-pr` infere PR aberto para branch atual e habilita auto-fix na web em um passo.

**Workflow:**
1. Push branch
2. Run `/autofix-pr`
3. Walk away
4. Claude watcha CI e review comments
5. Pusha fixes até ficar green

**Prioridade:** 🟡 MÉDIA - Útil mas requer integração web

---

### 7. **Routines** (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** Templated cloud agents que disparam em schedule, GitHub event, ou API call.

**Features:**
- Define routine uma vez na web com prompt, repos, connectors
- Triggers: PR-opened, release-published, webhook
- Cada routine tem endpoint `/fire` tokenizado

**Comando:**
```bash
/schedule daily PR review at 9am
```

**Prioridade:** 🔴 ALTA - Mas requer infraestrutura cloud (não aplicável ao OpenClaude open-source)

---

### 8. **Usage Breakdown** (Week 16)
**Status:** Parcialmente existe no OpenClaude  
**Descrição:** `/usage` mostra o que está driving limits: parallel sessions, subagents, cache misses, long context.

**Features:**
- Cada item com % das últimas 24h
- Tip para otimizar
- Press `d` ou `w` para switch entre day/week views
- Merge de `/cost` e `/stats` em `/usage`

**Prioridade:** 🟡 MÉDIA - OpenClaude já tem `/usage` mas pode melhorar breakdown

---

### 9. **Vim Visual Mode** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Press `v` para character selection ou `V` para line selection no prompt input, com operators e visual feedback.

**Prioridade:** 🟢 BAIXA - Nice to have para vim users

---

### 10. **Focus View** (Week 15)
**Status:** Não existe no OpenClaude  
**Descrição:** Press `Ctrl+O` em flicker-free mode para colapsar view para: último prompt, one-line tool summary com diffstats, resposta final de Claude.

**Prioridade:** 🟢 BAIXA - UX improvement

---

### 11. **Team Onboarding** (v2.1.101)
**Status:** Não existe no OpenClaude  
**Descrição:** `/team-onboarding` gera guia de ramp-up de teammate do uso local do Claude Code.

**Workflow:**
1. Run em projeto que você conhece bem
2. Passa output para novo teammate
3. Teammate replaya seu setup ao invés de começar do zero

**Prioridade:** 🟡 MÉDIA - Útil para onboarding de equipes

---

### 12. **Native Binaries** (v2.1.113)
**Status:** ✅ OpenClaude já usa binário nativo  
**Descrição:** CLI spawna binário nativo per-platform ao invés de bundled JavaScript.

**Prioridade:** ✅ JÁ IMPLEMENTADO

---

### 13. **Claude Opus 4.7 + xhigh Effort Level** (Week 16)
**Status:** Modelo não disponível no OpenClaude  
**Descrição:** Novo modelo mais forte para coding. Novo effort level `xhigh` entre `high` e `max`.

**Features:**
- `/effort` abre slider interativo com arrow keys
- Default effort agora é `high` para Pro/Max

**Prioridade:** 🔵 N/A - Depende de acesso ao modelo

---

### 14. **Hooks Melhorados**

#### MCP Tool Hooks (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Hooks podem chamar MCP tools diretamente via `type: "mcp_tool"`, sem spawnar processo.

**Prioridade:** 🟡 MÉDIA - Melhora performance de hooks

#### PreCompact Hooks (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** `PreCompact` hooks podem bloquear compaction exitando com code 2 ou retornando `{"decision":"block"}`.

**Prioridade:** 🟢 BAIXA - Edge case

---

### 15. **Hardened Bash Permissions** (Week 15-16)
**Status:** Parcialmente existe no OpenClaude  
**Descrição:** Deny rules agora matcham através de `env`/`sudo`/`watch` wrappers. `Bash(find:*)` allow rules não auto-aprovam `-exec` ou `-delete`.

**Melhorias adicionais:**
- Backslash-escaped flags
- Env-var prefixes
- `/dev/tcp` redirects
- Compound commands agora promptam corretamente

**Prioridade:** 🔴 ALTA - Segurança crítica

---

### 16. **Auto Mode Improvements** (Week 16-17)
**Status:** Parcialmente existe no OpenClaude  
**Descrição:** 
- Auto mode disponível para Max subscribers no Opus 4.7
- Flag `--enable-auto-mode` não é mais necessário
- Include `"$defaults"` em `autoMode.allow`, `soft_deny`, ou `environment` para adicionar regras custom junto com built-in list

**Prioridade:** 🟡 MÉDIA - Melhora UX de auto mode

---

### 17. **Forked Subagents** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Forked subagents podem ser habilitados com `CLAUDE_CODE_FORK_SUBAGENT=1`. Fork herda full conversation context ao invés de começar fresh.

**Prioridade:** 🟡 MÉDIA - Melhora context preservation

---

### 18. **Embedded Search Tools** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Native macOS/Linux builds substituem `Glob` e `Grep` tools com `bfs` e `ugrep` embedded disponíveis via Bash, para buscas mais rápidas sem round-trip de tool separada.

**Prioridade:** 🟡 MÉDIA - Performance improvement

---

### 19. **GitLab/Bitbucket Support** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** `--from-pr` agora aceita GitLab merge request, Bitbucket pull request, e GitHub Enterprise PR URLs além de github.com.

**Prioridade:** 🟡 MÉDIA - Expande compatibilidade

---

### 20. **Plugin Improvements**

#### Plugin Monitors (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** Plugins podem shippar background watchers via top-level `monitors` manifest key que auto-arms no session start ou skill invoke.

**Prioridade:** 🟢 BAIXA - Plugin ecosystem

#### Plugin Tag Command (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** `claude plugin tag` cria release git tags para plugins com version validation.

**Prioridade:** 🟢 BAIXA - Plugin ecosystem

---

### 21. **Settings Persistence** (Week 17)
**Status:** Parcialmente existe no OpenClaude  
**Descrição:** `/config` changes (theme, editor mode, verbose, etc) agora persistem para `~/.claude/settings.json` e seguem mesma precedência project/local/policy de outras settings.

**Prioridade:** 🟡 MÉDIA - Melhora UX

---

### 22. **Fewer Permission Prompts** (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** `/fewer-permission-prompts` scannea transcripts para common read-only Bash e MCP calls e propõe allowlist para `.claude/settings.json`.

**Prioridade:** 🟡 MÉDIA - Reduz friction

---

### 23. **Push Notifications** (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** Com Remote Control conectado e "Push when Claude decides" habilitado, Claude pode pingar phone quando precisa de você.

**Prioridade:** 🟢 BAIXA - Requer mobile app

---

### 24. **TUI Toggle** (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** `/tui` command e `tui` setting switcham entre classic e flicker-free rendering mid-conversation.

**Prioridade:** 🟢 BAIXA - UX preference

---

### 25. **Resume Optimization** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** `/resume` em large sessions é até 67% mais rápido e oferece summarizar stale, large sessions antes de re-ler.

**Prioridade:** 🟡 MÉDIA - Performance improvement

---

### 26. **Context Window Fix** (Week 17)
**Status:** Não existe no OpenClaude  
**Descrição:** Opus 4.7 sessions agora computam contra native 1M context window do modelo, fixando inflated `/context` percentages e premature autocompaction.

**Prioridade:** 🟡 MÉDIA - Accuracy improvement

---

### 27. **Sandbox Network Denied Domains** (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** `sandbox.network.deniedDomains` setting carve specific domains out de broader `allowedDomains` wildcard.

**Prioridade:** 🟢 BAIXA - Security edge case

---

### 28. **Command Aliases** (Week 16)
**Status:** Parcialmente existe no OpenClaude  
**Descrição:** 
- `/undo` é alias para `/rewind`
- `/proactive` é alias para `/loop`

**Prioridade:** 🟢 BAIXA - Convenience

---

### 29. **Prompt Caching 1H TTL** (Week 16)
**Status:** Não existe no OpenClaude  
**Descrição:** `ENABLE_PROMPT_CACHING_1H` opta API key, Bedrock, Vertex, e Foundry users em 1-hour prompt cache TTL.

**Prioridade:** 🟢 BAIXA - API-specific

---

### 30. **Perforce Mode** (Week 15)
**Status:** Não existe no OpenClaude  
**Descrição:** `CLAUDE_CODE_PERFORCE_MODE`: Edit/Write fail em read-only files com `p4 edit` hint ao invés de silently overwrite.

**Prioridade:** 🟢 BAIXA - Niche use case

---

## 📊 Resumo de Prioridades

### 🔴 ALTA (Implementar primeiro)
1. **Monitor Tool** - Melhora significativa de UX
2. **Hardened Bash Permissions** - Segurança crítica

### 🟡 MÉDIA (Implementar depois)
1. **Session Recap** - Nice to have para power users
2. **Usage Breakdown** - Melhorar breakdown existente
3. **Team Onboarding** - Útil para onboarding
4. **MCP Tool Hooks** - Performance de hooks
5. **Auto Mode Improvements** - Melhora UX
6. **Forked Subagents** - Context preservation
7. **Embedded Search Tools** - Performance
8. **GitLab/Bitbucket Support** - Compatibilidade
9. **Settings Persistence** - UX
10. **Fewer Permission Prompts** - Reduz friction
11. **Resume Optimization** - Performance
12. **Context Window Fix** - Accuracy

### 🟢 BAIXA (Nice to have)
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

### 🔵 N/A (Não aplicável ao OpenClaude)
- **Ultraplan** - Requer cloud infrastructure
- **Ultrareview** - Requer cloud infrastructure
- **Routines** - Requer cloud infrastructure
- **Claude Opus 4.7** - Modelo proprietário

---

## 🎯 Roadmap Sugerido

### Phase 1: Security & Core (Sprint 1-2)
1. Hardened Bash Permissions
2. Monitor Tool (MVP)

### Phase 2: UX Improvements (Sprint 3-4)
1. Session Recap
2. Usage Breakdown melhorado
3. Settings Persistence

### Phase 3: Advanced Features (Sprint 5-6)
1. MCP Tool Hooks
2. Forked Subagents
3. Embedded Search Tools

### Phase 4: Ecosystem (Sprint 7+)
1. GitLab/Bitbucket Support
2. Team Onboarding
3. Fewer Permission Prompts
4. Plugin improvements

---

## 📝 Notas de Implementação

### Monitor Tool - Detalhes Técnicos
```typescript
// Proposta de API
interface MonitorToolParams {
  command: string;        // Comando shell para monitorar
  description: string;    // Descrição do que está sendo monitorado
  pattern?: string;       // Regex pattern para filtrar eventos
  maxEvents?: number;     // Limite de eventos antes de auto-stop
  timeout?: number;       // Timeout em ms
}

interface MonitorEvent {
  timestamp: string;
  line: string;
  matched?: boolean;      // Se matchou pattern
}

// Retorna task_id
// Stream eventos como <task-notification>
```

### Hardened Bash Permissions - Casos a Cobrir
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

---

## 🔗 Fontes

- [Week 15 · April 6–10, 2026](https://code.claude.com/docs/en/whats-new/2026-w15)
- [Week 16 · April 13–17, 2026](https://code.claude.com/docs/en/whats-new/2026-w16)
- [Week 17 · April 20–24, 2026](https://code.claude.com/docs/en/whats-new/2026-w17)
- [Claude Code Changelog](https://claudefa.st/blog/guide/changelog)
- [Claude Updates by Anthropic - April 2026](https://releasebot.io/updates/anthropic/claude)
