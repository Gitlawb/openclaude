# Phase 4 — Second Brain Agent: Design Spec

**Data:** 2026-05-04  
**Branch alvo:** `feat/serve`  
**Plano de implementação:** `docs/superpowers/plans/2026-05-04-second-brain-phase4-plan.md` (a criar)  
**Status:** Aprovado pelo usuário — pronto para implementação

---

## 1. Objetivo

Transformar o OpenClaude de um "chat com vault tools" em um **agente ativo de segundo cérebro**: ao ser consultado, ele navega o vault, busca informações externas, propõe edições e termina toda resposta com sugestões concretas de próximos passos.

### Capacidades alvo

| Categoria | Capacidade |
|-----------|-----------|
| Vault CRUD | Listar, ler, buscar, criar, editar, deletar, renomear, mover notas |
| Web | Busca externa (Brave Search), importar conteúdo de página |
| Formatação | Resumir N notas, reformatar por instrução, sugerir wikilinks |
| UX | Chips clicáveis de próximos passos, indicadores de web search |
| Persona | System prompt estruturado — identidade, regras, formato de resposta |

---

## 2. Arquitetura

### 2.1 Estrutura de arquivos (antes → depois)

**Antes (Phase 3):**
```
src/serve/
├── agentAdapter.ts     ← 500+ linhas: orquestrador + todas as tool defs + loop
└── vaultUtils.ts       ← walk, searchVault, readNote, vaultRelative
```

**Depois (Phase 4):**
```
src/serve/
├── agentAdapter.ts     ← ~150 linhas: orquestrador limpo
├── vaultUtils.ts       ← (existente, sem mudanças)
└── tools/
    ├── registry.ts     ← compõe tools por contexto disponível
    ├── vaultTools.ts   ← 7 tool defs + runVaultTool()
    ├── webTools.ts     ← 2 tool defs + runWebTool()
    └── formatTools.ts  ← 3 tool defs + runFormatTool()
```

### 2.2 Princípio do registry

```typescript
// src/serve/tools/registry.ts
export function buildRegistry(ctx: ToolContext): ToolModule[] {
  return [
    ...vaultTools(ctx.vault),          // só se vault disponível
    ...webTools(ctx.braveApiKey),      // só se API key configurada
    ...formatTools(ctx.vault),         // só se vault disponível
  ];
}

export interface ToolContext {
  vault?: string;
  braveApiKey?: string;
  pendingEditStore?: PendingEditStore;
  sessionId?: string;
}
```

Tools ausentes do registry = modelo não as vê = nunca tenta chamá-las.

### 2.3 Interface de módulo de tool

```typescript
export interface ToolModule {
  definition: OpenAIToolDefinition;   // passado ao LLM
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<VaultToolResult>;
}
```

Cada módulo exporta um array de `ToolModule`. O `agentAdapter.ts` consome esse array sem precisar conhecer detalhes de implementação de cada tool.

### 2.4 Fluxo de dados completo

```
Usuário → sidebar → POST /chat {message, sessionId, context}
                              ↓
         agentAdapter: buildRegistry(context) → monta lista de tools
                              ↓
         LLM loop (max 8 turns):
           stream response
           → se finish_reason == "tool_calls":
               ├── vaultTools: operações locais em fs
               ├── webTools: HTTP externo (Brave API)
               └── formatTools: LLM sub-call + vault write
           → inject tool results → continue
           → se finish_reason == "stop":
               extractSuggestions(assembledText) → emit "suggestions"
               emit "done"
                              ↓
         SSE events para o plugin:
           token | tool_call | tool_result | pending_edit | suggestions | done | error
```

---

## 3. Catálogo de Tools

### 3.1 `vaultTools.ts` — 7 tools

| Tool | Args | Retorno | Notas |
|------|------|---------|-------|
| `list_vault` | `subdir?: string` | `string[]` paths relativos | Existente — migrar |
| `read_note` | `path: string` | conteúdo markdown ou null | Existente — migrar |
| `search_vault` | `query: string, maxResults?: number` | `SearchHit[]` | Existente — migrar |
| `write_note` | `path, content, reason` | pending edit id | Existente — migrar |
| `delete_note` | `path: string, reason: string` | pending delete id | **Novo** — move para `.trash/` |
| `rename_note` | `path, newName, reason` | pending rename id | **Novo** — atualiza wikilinks |
| `move_note` | `path, newPath, reason` | pending move id | **Novo** — atualiza wikilinks |

**Comportamento de delete/rename/move:**
- Todas as operações destrutivas passam pelo `PendingEditStore` — nada acontece sem aprovação
- `delete_note`: move para `{vault}/.trash/{nome}-{timestamp}.md` (não apaga permanentemente)
- `rename_note` e `move_note`: atualizam todos os `[[wikilinks]]` que referenciam a nota original

**Segurança:** path traversal bloqueado em todas as tools via `resolve()` + prefixo check (padrão da Phase 3, aplicado às novas).

### 3.2 `webTools.ts` — 2 tools

| Tool | Args | Retorno | Provider |
|------|------|---------|---------|
| `web_search` | `query: string, maxResults?: number` | `WebResult[]` | Brave Search API |
| `fetch_page` | `url: string` | texto limpo (sem HTML) | fetch nativo + strip |

```typescript
interface WebResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}
```

**Brave Search API:**
- Endpoint: `https://api.search.brave.com/res/v1/web/search`
- Header: `X-Subscription-Token: {BRAVE_API_KEY}`
- Tier gratuito: 2.000 req/mês
- Configuração: `settings.braveApiKey` no plugin → env `BRAVE_API_KEY` no servidor

**`fetch_page`:**
- Faz GET na URL, extrai apenas o texto via regex strip de tags HTML
- Trunca em 8.000 chars para evitar overflow de contexto
- Timeout de 10s

### 3.3 `formatTools.ts` — 3 tools

| Tool | Args | Retorno |
|------|------|---------|
| `summarize_notes` | `paths: string[], style: "bullet"\|"narrative"\|"zettelkasten", targetPath: string` | pending edit na nota destino |
| `format_note` | `path: string, instructions: string` | pending edit com nota reformatada |
| `suggest_links` | `path: string` | array de `LinkSuggestion` |

```typescript
interface LinkSuggestion {
  targetNote: string;        // nota que deveria ter o link
  suggestedLink: string;     // o wikilink a inserir
  reason: string;            // por que sugerir
  occurrences: number;       // quantas vezes o termo aparece sem link
}
```

**`summarize_notes`:**
1. Lê cada nota em `paths[]` via `readNote()`
2. Monta prompt: `"Resuma estas notas no estilo {style}: ..."`
3. Chama o LLM via sub-call (sem tools, sem streaming)
4. Cria `pending edit` na nota `targetPath` via `PendingEditStore`

**`format_note`:**
1. Lê a nota original
2. Monta prompt: `"Reformate esta nota com as instruções: {instructions}. Nota: ..."`
3. LLM gera novo conteúdo
4. Cria pending edit

**`suggest_links`:**
- Sem embeddings: usa busca textual por termos-chave extraídos da nota alvo
- Identifica termos que aparecem em outras notas sem estar entre `[[]]`
- Phase 5 adiciona embeddings vetoriais para semântica mais rica

---

## 4. Persona do Agente

### 4.1 System prompt (Phase 4)

```
Você é o OpenClaude — assistente de segundo cérebro para o vault Obsidian
localizado em: {vault}.

O vault segue metodologia PARA (Projetos/Áreas/Recursos/Arquivo) com MOCs
(Maps of Content) e notas Zettelkasten. Estrutura típica:
  00-Inbox / 01-MOC / 02-Zettelkasten / 03-Projetos / 05-[domínio]

## Responsabilidades
1. NAVEGAR antes de responder — use list_vault e read_note para entender
   o contexto real, nunca suponha o conteúdo de uma nota
2. CONECTAR conhecimento — identifique notas relacionadas, wikilinks
   ausentes, lacunas de conteúdo
3. CONSTRUIR informação — crie/formate/consolide notas via write_note
   (sempre com diff para aprovação do usuário)
4. BUSCAR externamente — use web_search quando o vault não tiver a
   informação ou quando o tema for recente/dinâmico
5. SUGERIR próximos passos — toda resposta termina com ações concretas

## Regras de tools
- Sempre list_vault → read_note → responda (nunca invente conteúdo)
- Use search_vault antes de afirmar que algo não existe no vault
- Use web_search quando: usuário pede info externa, tema é recente,
  vault está desatualizado
- write_note cria um pending edit — nunca diga "nota criada" sem evento
  pending_edit ter sido emitido

## Formato
- Responda sempre em markdown
- Respostas longas: use headers (##)
- Comparações: use tabelas
- Língua: sempre PT-BR (salvo instrução contrária)

## Encerramento obrigatório
Termine TODA resposta com esta seção exata:

📋 **Próximos Passos**
1. [comando direto, máx 12 palavras]
2. [comando direto, máx 12 palavras]
3. [comando direto, máx 12 palavras]

Os itens devem ser comandos que o usuário envia diretamente ao chat.
✅ "resuma as notas de projetos ativos"
✅ "busque tendências de mercado livre de energia e crie uma nota"
❌ "considere atualizar suas notas" (vago, não é um comando)
```

### 4.2 Extração de sugestões (server-side)

Após o stream final (`finishReason === "stop"`), o servidor parseia o texto acumulado e emite o evento `suggestions` antes do `done`:

```typescript
function extractSuggestions(text: string): string[] {
  const match = text.match(
    /📋\s*\*\*Próximos Passos\*\*\n([\s\S]*?)(?:\n\n|$)/
  );
  if (!match) return [];
  return match[1]
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*\[?\s*/, '').replace(/\]?\s*$/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}
```

### 4.3 Novo tipo de evento SSE

```typescript
// src/serve/handlers/chat.ts — adicionar ao union AgentEvent
| { event: "suggestions"; data: { items: string[] } }
```

`AgentEvent` está definido em `chat.ts` (não em `sse.ts`). O TypeScript força handlers em todos os switch/case que usam `_exhaustive: never` — incluindo `sidebar-view.ts` no plugin.

---

## 5. Plugin UI

### 5.1 Chips de Próximos Passos

O plugin trata o evento `suggestions` na `sidebar-view.ts`:

```typescript
case 'suggestions': {
  const container = contentEl.parentElement?.createDiv({ cls: 'oc-suggestions' });
  evt.data.items.forEach(item => {
    const chip = container?.createEl('button', {
      cls: 'oc-suggestion-chip',
      text: item
    });
    chip?.addEventListener('click', () => this.sendMessage(item));
  });
  break;
}
```

**Estilo visual:**
```css
.oc-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.oc-suggestion-chip {
  background: var(--interactive-accent-hover);
  border: 1px solid var(--interactive-accent);
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.oc-suggestion-chip:hover { background: var(--interactive-accent); color: white; }
```

### 5.2 Indicador de web search

Na `handleEvent()` da sidebar, quando `tool_call.name === "web_search"`:

```typescript
case 'tool_call': {
  const icon = evt.data.name === 'web_search' ? '🌐' : '🔧';
  el.setText(`${icon} ${evt.data.name}…`);
  // ...
}
```

### 5.3 CommandHub — novos presets

Substituir os 6 presets atuais por:

```typescript
const PHASE4_PRESETS = [
  { label: '💬 Resumir nota ativa',        message: 'resuma a nota ativa e sugira melhorias' },
  { label: '🌐 Pesquisar na web',           message: 'pesquise na web sobre: ' },  // placeholder
  { label: '📝 Criar nota',                 message: 'crie uma nota sobre: ' },
  { label: '🔗 Sugerir wikilinks perdidos', message: 'sugira wikilinks ausentes na nota ativa' },
  { label: '📂 Renomear/mover nota',        message: 'renomeie a nota ativa para: ' },
  { label: '🗂️  Consolidar notas similares', message: 'consolide as notas similares à nota ativa' },
];
```

### 5.4 Settings — campo Brave API Key

```typescript
// settings.ts — adicionar ao PluginSettings
braveApiKey: string;  // default: ''

// SettingsTab — novo campo
new Setting(containerEl)
  .setName('Brave Search API Key')
  .setDesc('Para habilitar buscas na web. Obtenha em brave.com/search/api')
  .addText(text => text
    .setPlaceholder('BSA...')
    .setValue(this.plugin.settings.braveApiKey)
    .onChange(async (value) => {
      this.plugin.settings.braveApiKey = value;
      await this.plugin.saveSettings();
    }));
```

A key é enviada ao servidor no `context` do chat request e usada pelo registry para habilitar `webTools`.

---

## 6. Tratamento de Erros

| Cenário | Comportamento |
|---------|--------------|
| Brave API key inválida | `web_search` retorna erro descritivo; agente responde sem web |
| Vault inacessível durante tool call | Tool retorna `{ok: false, content: "Vault não encontrado"}` |
| `fetch_page` timeout (>10s) | Retorna erro com URL; agente informa usuário |
| `summarize_notes` com paths inexistentes | Paths inválidos ignorados; se todos inválidos, retorna erro |
| LLM falha no sub-call de formatTools | Propaga como erro SSE; pending edit não é criado |
| Max turns (8) atingido | `finishReason: "max_turns"`; agente informa que não completou |

---

## 7. Testes

### Estratégia por módulo

| Arquivo de teste | O que cobre |
|-----------------|-------------|
| `src/serve/tools/vaultTools.test.ts` | Cada tool com vault temp; path traversal; pending edits |
| `src/serve/tools/webTools.test.ts` | Mock HTTP server; timeout; strip HTML |
| `src/serve/tools/formatTools.test.ts` | Mock LLM; summarize/format/suggest logic |
| `src/serve/tools/registry.test.ts` | Composição correta por contexto; ausência de key desativa webTools |
| `src/serve/agentAdapter.test.ts` | Loop com mock server; suggestions extraction; max turns |

### Teste de regressão

Após refatoração (Task 1), rodar:
```bash
bun test src/serve/    # deve manter 107+ pass, 0 fail
```

### E2E no Obsidian (Task 6)

| Prompt | Evento esperado | Resultado esperado |
|--------|----------------|--------------------|
| `liste as notas do vault` | `tool_call: list_vault` | Listagem formatada |
| `pesquise sobre energia solar` | `tool_call: web_search` | Resultados com fonte |
| `resuma a nota ativa` | `tool_call: read_note` + `write_note` | Pending edit com resumo |
| `sugira wikilinks na nota ativa` | `tool_call: suggest_links` | Lista de sugestões |
| `delete a nota Teste/Nota-Agente.md` | `tool_call: delete_note` | Pending delete para `.trash/` |

---

## 8. Configuração

### Variáveis de ambiente (servidor)

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `CLAUDE_CODE_USE_OPENAI` | Habilita path OpenAI/Ollama | não definido |
| `OPENAI_BASE_URL` | URL do provider (Ollama: `http://localhost:11434/v1`) | `https://api.openai.com/v1` |
| `OPENAI_API_KEY` | API key do provider | obrigatório |
| `OPENCLAUDE_MODEL` | Nome do modelo | `gpt-4o-mini` |
| `BRAVE_API_KEY` | Chave para web search | não definido (web tools desabilitadas) |

### `.env` atualizado

```bash
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=qwen3-vl:235b-cloud
OPENCLAUDE_MODEL=qwen3-vl:235b-cloud
BRAVE_API_KEY=                         # preencher para habilitar web search
```

---

## 9. Decisões fechadas (não re-discutir)

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Web search provider | Brave Search API | 2k req/mês grátis; sem rastreamento; REST simples |
| Sugestões: parsing | Server-side evento `suggestions` | Tipado, não frágil, reutilizável |
| Delete de notas | Move para `.trash/` (não apaga) | Segurança — caminho de retorno |
| Embeddings | Não no Phase 4 | Scope; suggest_links textual é suficiente para MVP |
| Max turns | 8 (era 5) | Workflows de summarize precisam de mais turns |
| Tool registry | Dinâmico por contexto | Tools ausentes = modelo não tenta chamá-las |

---

## 10. Questões em aberto (decidir antes da implementação)

1. ~~**Brave API key UX**~~ — **FECHADO:** key inserida nas Settings do plugin → enviada no campo `context.braveApiKey` do chat request → registry usa para habilitar `webTools`. O tipo `context` em `chat.ts` precisa adicionar `braveApiKey?: string`.
2. **`rename_note` + wikilinks**: Atualizar wikilinks é O(n) sobre todo o vault. Para vaults grandes (>500 notas), pode ser lento. Adicionar progress event ou fazer async?
3. **`summarize_notes` sub-call**: Usar o mesmo modelo ou permitir modelo mais leve configurável?

---

## 11. Fases futuras (fora do escopo Phase 4)

- **Phase 5:** Embeddings vetoriais para `suggest_links` semântico
- **Phase 5:** Testes E2E Playwright automatizados
- **Phase 5:** CLI installer + distribuição (Obsidian Community Plugins)
- **Phase 6:** Agendamento proativo (background jobs)
- **Phase 6:** Multi-vault cross-search
