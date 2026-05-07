# Design — Sprint Paralelo: Melhorias Phase 3+4

**Data:** 2026-05-07  
**Autor:** Alan + Claude (brainstorming)  
**Status:** Aprovado pelo usuário — pronto para plano de implementação  
**Abordagem escolhida:** C — Sprint paralelo por camada (3 trilhas simultâneas)  
**Branch alvo:** `feat/serve` (T2), `feat/plugin` (T3), integração final em `main`

---

## 1. Contexto

Ao avaliar o estado atual do sistema em 2026-05-07, foram identificados os seguintes fatos:

- **Phase 1 (servidor HTTP):** 20/20 tasks completas, 93 testes passando — ✅
- **Phase 2 (plugin Obsidian):** 10/10 tasks completas, 21 testes passando — ✅
- **Phase 3 (vault tools):** implementada em `feat/serve` (commits de maio 2026) mas sem tag ou plano formal de conclusão
- **Phase 4 (second brain agent):** parcialmente implementada — thought tools, persona argumentativa, web tools, format tools, registry pattern — mas com gaps críticos

**HANDOFF desatualizado:** o documento `docs/superpowers/HANDOFF.md` ainda aponta "próximo passo: Plano #3", estando 2 sessões atrás do estado real do código.

---

## 2. Gaps identificados

### Críticos

| Gap | Impacto | Arquivo(s) |
|-----|---------|------------|
| Thought tools travados em `CLAUDE_CODE_USE_OPENAI` | Provider default (Qwen3/Ollama) não acessa a feature central do sistema | `src/serve/tools/thoughtTools.ts`, `registry.ts` |
| Plugin ignora eventos SSE Phase 4 | Suggestions, thought tools e web search invisíveis para o usuário | `plugin/src/sidebar-view.ts` |

### Altos

| Gap | Impacto | Arquivo(s) |
|-----|---------|------------|
| Wikilinks não atualizam no rename/move | Vault fica inconsistente após renomear/mover notas | `src/serve/tools/vaultTools.ts`, `vaultUtils.ts` |
| Branches `feat/serve` e `feat/plugin` divergidas + HANDOFF stale | Risco de perda de contexto entre sessões, dificuldade de integração | `docs/superpowers/HANDOFF.md`, branches |

### Médios

| Gap | Impacto | Arquivo(s) |
|-----|---------|------------|
| P3 permission model não enforçado no agent loop | Agente executa qualquer tool sem filtro de permissão | `src/serve/agentAdapter.ts` (novo: `permissions.ts`) |
| Sem teste com vault real | Comportamentos de encoding, estrutura de links e tamanho não validados | — |

---

## 3. Arquitetura do sprint paralelo

```
feat/serve (base) ──┬── worktree-server  → T2: thought tools + wikilinks + P3
                    ├── worktree-plugin  → T3: plugin Phase 4 UI
                    └── (T1 por último)  → T1: contrato SSE + merge + HANDOFF
```

**Regra de execução:** T2 e T3 rodam em paralelo (subagents independentes). T1 roda por último, integra os dois e faz o merge final para `main`.

**Pré-requisito crítico:** antes de T2 e T3 começarem, T1 commita o contrato de tipos SSE em `src/serve/types.ts` (ou arquivo compartilhado). Isso evita divergência de interface entre as trilhas.

---

## 4. Trilha 2 — Server (`worktree-server`, base: `feat/serve`)

### T2.1 — Thought tools para todos os providers

**Problema:** Guard `process.env.CLAUDE_CODE_USE_OPENAI` bloqueia thought tools no Qwen3/Ollama.

**Solução:** Substituir o guard por detecção de capacidade em runtime. O `buildRegistry(ctx)` inclui thoughtTools apenas se `ctx.supportsOpenAIFunctions === true`. Essa flag é detectada no startup do servidor com base na configuração do provider ativo:

- `OPENAI_BASE_URL` configurado → `supportsOpenAIFunctions = true`
- `OLLAMA_HOST` com modelo que suporta function calling → `supportsOpenAIFunctions = true`
- Fallback: `false` (Anthropic nativo usa tool_use diferente)

**Arquivos afetados:**
- `src/serve/tools/registry.ts` — trocar env var por `ctx.supportsOpenAIFunctions`
- `src/serve/tools/thoughtTools.ts` — remover guard interno
- `src/serve/agentAdapter.ts` — detectar e passar `supportsOpenAIFunctions` no contexto
- `src/serve/tools/registry.test.ts` — testes para os dois caminhos (com/sem suporte)

```typescript
// registry.ts — depois
export function buildRegistry(ctx: ToolContext): ToolModule[] {
  return [
    ...vaultTools(ctx.vault),
    ...webTools(ctx.braveApiKey),
    ...formatTools(ctx.vault),
    ...(ctx.supportsOpenAIFunctions ? thoughtTools() : []),
  ];
}
```

### T2.2 — Wikilinks update no rename/move

**Problema:** `rename_note` e `move_note` movem o arquivo mas deixam `[[wikilinks]]` em outras notas apontando para o nome antigo.

**Solução:** Nova função `findWikilinks(vault, noteName): string[]` em `vaultUtils.ts` que escaneia o vault e retorna paths de todos os arquivos `.md` que contêm `[[noteName]]` ou `[[noteName|alias]]`. Após criar o pending edit do arquivo renomeado, criar pending edits adicionais para cada backlink — agrupados como batch operation no `PendingEditStore`.

**Arquivos afetados:**
- `src/serve/vaultUtils.ts` — nova fn `findWikilinks(vault, noteName)`
- `src/serve/tools/vaultTools.ts` — `rename_note` e `move_note` chamam `findWikilinks` e criam batch de pending edits
- `src/serve/vaultUtils.test.ts` — testes para `findWikilinks`
- `src/serve/tools/vaultTools.test.ts` — testes de rename/move com backlinks

```typescript
// vaultUtils.ts
export function findWikilinks(vault: string, noteName: string): string[] {
  // stem = nome sem extensão
  const stem = noteName.replace(/\.md$/, "");
  const pattern = new RegExp(`\\[\\[${escapeRegex(stem)}(\\|[^\\]]+)?\\]\\]`);
  return walk(vault).filter(f => {
    const content = readFileSync(f, "utf8");
    return pattern.test(content);
  });
}
```

**Comportamento do batch:**
- Plugin recebe um `pending_edit` com `type: "batch"` contendo N edits agrupados
- Diff Preview Modal mostra cada arquivo afetado com checkbox individual
- Aprovação em massa ou arquivo por arquivo

### T2.3 — P3 permission middleware no agent loop

**Problema:** O agente executa qualquer tool sem checar o preset de permissão configurado pelo usuário.

**Solução:** Novo módulo `src/serve/permissions.ts` com função `checkPermission(tool, args, preset)` que retorna `{allowed: true}` ou `{allowed: false, reason, suggestedAction}`. Chamado em `agentAdapter.ts` antes de cada `runTool()`.

**Novo arquivo:** `src/serve/permissions.ts`

```typescript
// permissions.ts
export type Preset = "conservador" | "balanceado" | "agressivo";

export function checkPermission(
  toolName: string,
  args: Record<string, unknown>,
  preset: Preset
): { allowed: boolean; reason?: string } {
  // conservador: read ✓, write→diff, delete→block, bash→block
  // balanceado:  read ✓, write→diff, delete→ask, bash→ask
  // agressivo:   read ✓, write ✓, delete→ask, bash→ask
}
```

**Preset carregado de:** `.openclaude/permissions.yml` no vault ativo (fallback: "balanceado").

**Arquivos afetados:**
- `src/serve/permissions.ts` — novo arquivo
- `src/serve/agentAdapter.ts` — integrar `checkPermission` no loop
- `src/serve/permissions.test.ts` — testes dos 3 presets × todas as tools

---

## 5. Trilha 3 — Plugin (`worktree-plugin`, base: `feat/plugin`)

### T3.1 — Chips clicáveis de sugestões

**Problema:** Servidor emite `event: suggestions` mas `sidebar-view.ts` ignora esse evento.

**Solução:** Adicionar handler para `suggestions` no parser SSE do `sidebar-view.ts`. Renderizar chips abaixo da última mensagem do agente. Click num chip preenche o `inputEl` e envia a mensagem automaticamente.

**Arquivo afetado:** `plugin/src/sidebar-view.ts`

```typescript
// sidebar-view.ts — no handleSseEvent()
case "suggestions": {
  const items: string[] = evt.data.items ?? [];
  this.renderSuggestionChips(items);
  break;
}

renderSuggestionChips(items: string[]) {
  const container = this.chatEl.createDiv({ cls: "oc-suggestions" });
  for (const text of items.slice(0, 5)) {
    const chip = container.createEl("button", { cls: "oc-chip", text });
    chip.onclick = () => {
      this.inputEl.value = text;
      this.sendMessage();
    };
  }
}
```

**CSS novo em `styles.css`:**
```css
.oc-suggestions { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.oc-chip { background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
           border-radius: 20px; padding: 3px 12px; font-size: 12px; cursor: pointer; }
.oc-chip:hover { background: var(--background-modifier-hover); }
```

### T3.2 — Indicadores de web search e thought tools

**Problema:** `tool_call` para `web_search` e `structure_thought` renderizados igual a qualquer outro tool, sem distinção visual.

**Solução:** Distinguir visualmente no `sidebar-view.ts` baseado no `name` do tool:

**Web search:**
- `tool_call {name: "web_search"}` → badge azul `🌐 Buscando...` (spinner)
- `tool_result {name: "web_search"}` → badge `🌐 N resultados`

**Thought tools:**
- `tool_call {name: "structure_thought" | "refine_argument" | "counter_argument"}` → bloco colapsável roxo `🧠 [label]...`
- `tool_result` → preenche o bloco com output (colapsado por default, expandível no click)

**Arquivo afetado:** `plugin/src/sidebar-view.ts`

**Novos tipos SSE a consumir** (definidos em T1.3):
```typescript
{ event: "thought_start",      data: { name: string, label: string } }
{ event: "thought_result",     data: { name: string, output: string } }
{ event: "web_search_start",   data: { query: string } }
{ event: "web_search_result",  data: { count: number, preview: string } }
```

---

## 6. Trilha 1 — Infra (roda por último)

### T1.0 — Contrato SSE (pré-requisito, commitar ANTES de T2+T3)

Adicionar os novos tipos SSE em `src/serve/types.ts` (servidor) e em `plugin/src/types.ts` (plugin):

```typescript
// Novos eventos Phase 4 (adicionais aos já existentes)
| { event: "thought_start";      data: { name: string; label: string } }
| { event: "thought_result";     data: { name: string; output: string } }
| { event: "web_search_start";   data: { query: string } }
| { event: "web_search_result";  data: { count: number; preview: string } }
```

### T1.1 — HANDOFF atualizado

Atualizar `docs/superpowers/HANDOFF.md` documentando:
- Phase 3 completa (vault tools: list, read, search, write, delete, rename, move + wikilinks)
- Phase 4 completa (thought tools, persona, web tools, format tools, registry, P3 middleware)
- Estado das branches após merge
- Lições aprendidas do sprint paralelo
- Novo kick-off prompt refletindo estado atual

### T1.2 — Merge strategy

```
worktree-server → commit → merge em feat/serve
worktree-plugin → commit → merge em feat/plugin
feat/plugin     → merge em feat/serve (resolver conflitos)
feat/serve      → PR → main
tag: phase-3-4-complete
```

### T1.3 — Validação pós-merge

Após merge completo:
- `bun test src/serve/` — deve manter 93+ testes (+ novos de T2)
- `bun test tests/` (plugin) — deve manter 21+ testes (+ novos de T3)
- Smoke manual: `openclaude serve --port 7777` + abrir plugin no Obsidian + testar chips e thought tools
- Atualizar MEMORY no Claude (project_state.md)

---

## 7. Contrato de interfaces (T2 ↔ T3)

Para que T2 e T3 rodem em paralelo sem conflito de interface, os seguintes contratos são fixados:

### SSE events (servidor emite, plugin consome)

| Event | Data | Emitido por |
|-------|------|-------------|
| `thought_start` | `{name, label}` | T2 — thoughtTools |
| `thought_result` | `{name, output}` | T2 — thoughtTools |
| `web_search_start` | `{query}` | T2 — webTools |
| `web_search_result` | `{count, preview}` | T2 — webTools |
| `suggestions` | `{items: string[]}` | já existe |

### ToolContext (novo campo)

```typescript
interface ToolContext {
  vault?: string;
  braveApiKey?: string;
  pendingEditStore?: PendingEditStore;
  sessionId?: string;
  supportsOpenAIFunctions: boolean;  // NOVO — T2.1
  preset?: Preset;                   // NOVO — T2.3
}
```

---

## 8. Testes

### Por trilha

| Trilha | Testes novos obrigatórios |
|--------|--------------------------|
| T2.1 | registry com/sem `supportsOpenAIFunctions`; thoughtTools via Ollama mock |
| T2.2 | `findWikilinks` — casos: sem backlinks, 1 backlink, N backlinks, alias, path traversal |
| T2.3 | `checkPermission` × 3 presets × todas as tool categories |
| T3.1 | `renderSuggestionChips` com 0, 3, 7 itens (max 5); click envia mensagem |
| T3.2 | Handler SSE para `thought_start`/`result`, `web_search_start`/`result` |

### Meta pós-sprint

- Servidor: ≥ 110 testes passando
- Plugin: ≥ 30 testes passando
- Typecheck: zero erros em ambos

---

## 9. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Conflito de merge feat/plugin ↔ feat/serve (types.ts duplicado) | Média | T1.0 define contrato SSE antes de T2+T3 começarem |
| Qwen3/Ollama não suporta function calling no modelo usado | Média | `supportsOpenAIFunctions` detecta em runtime; fallback gracioso sem thought tools |
| `findWikilinks` lento em vaults grandes (10k+ notas) | Baixa | Limite de 200 arquivos retornados; alert se vault > 5k notas |
| Plugin quebra ao receber eventos SSE desconhecidos | Baixa | Handler com `default: break` no switch — ignora eventos não reconhecidos |

---

## 10. Questões em aberto

1. **Qwen3 function calling:** confirmar se o modelo `qwen3-vl:235b-cloud` suporta OpenAI function calling — testar com `curl` antes de T2.1
2. **Batch pending edits no plugin:** o DiffPreviewModal atual suporta batch? Ou precisa de extensão para T2.2?
3. **Preset padrão:** o arquivo `.openclaude/permissions.yml` precisa existir antes do uso ou o servidor deve criar com defaults?

---

## 11. Cronograma estimado

- **T1.0 (contrato SSE):** 15 minutos — commitar antes de tudo
- **T2 + T3 (paralelo):** 1 sessão cada — ~2-3 horas de trabalho focado
- **T1 (merge + integração):** 1 sessão — ~1-2 horas incluindo smoke test
- **Total:** 1-2 sessões de desenvolvimento intenso

---

## 12. Métricas de sucesso

- Thought tools funcionando com Qwen3/Ollama (provider default do usuário)
- Plugin exibe chips de sugestões clicáveis após cada resposta do agente
- rename_note e move_note atualizam wikilinks em todo o vault
- `bun test` passa com ≥ 110 testes no servidor e ≥ 30 no plugin
- HANDOFF reflete estado real do projeto após o sprint
