# Knowledge Base — OpenClaude Agent Autonomy

Este diretório é a **memória de projeto versionada**: o que aprendemos sobre routing, modelos, falhas e padrões de desenvolvimento neste workspace.

Não substitui a memória automática de sessão (`~/.claude/projects/.../memory/`).  
Complementa: o que vale para **todo o time / todo o repo** sobe para cá.

---

## Camadas de conhecimento

| Camada | Onde | Quem escreve | Quando usar |
|--------|------|--------------|-------------|
| Sessão | `~/.claude/projects/<hash>/memory/` | extractMemories / autoDream | Preferências e fatos de curto prazo |
| Telemetria | `~/.openclaude/telemetry/turns.jsonl` | Autonomy Controller | Métricas de rota, latência, sucesso |
| Insights | `~/.openclaude/insights/*.md` | SessionInsightExtractor | Candidatos a promoção |
| **Projeto (este folder)** | `docs/superpowers/knowledge/` | humano ou `/promote-knowledge` | Regras estáveis e lições validadas |

---

## Índice

| Arquivo | Tema | Status |
|---------|------|--------|
| [ROUTING_BASELINE.md](./ROUTING_BASELINE.md) | Modelos e routing atuais (baseline) | Preencher no Task 0.1 |
| [SESSION_INSIGHTS_TEMPLATE.md](./SESSION_INSIGHTS_TEMPLATE.md) | Template de insight de sessão | Pronto |
| *(promovidos)* | Lições validadas pós-sessão | Após Phase 4 |

---

## Como promover conhecimento

1. Use o agente em modo `smart` e complete tarefas reais.
2. No fim da sessão, revise insights em `~/.openclaude/insights/` (quando Phase 4 existir).
3. Promova com `/promote-knowledge` **ou** copie manualmente para  
   `docs/superpowers/knowledge/YYYY-MM-DD-<slug>.md`.
4. Atualize esta tabela de índice.
5. Se a lição mudar comportamento default, atualize também:
   - `PLAYBOOK.md`
   - `GUIA_USO.md` (se for UX/config)
   - `taskRouting` em `~/.claude/settings.json` (se for política de modelo)

### Critérios de promoção

Promova se **pelo menos um** for verdadeiro:

- Ocorreu ≥ 2 vezes em sessões diferentes
- Economizou tempo/custo de forma mensurável
- Evitou uma classe de erro (tool loop, modelo errado, provider down)
- É regra de ouro do repositório (build, test, paths Windows)

**Não** promova: preferências pessoais passageiras, chaves, paths de máquina sem generalização.

---

## Formato de uma lição promovida

```markdown
# YYYY-MM-DD — <título curto>

**Contexto:** …
**Sintoma:** …
**Ação:** …
**Resultado:** …
**Política sugerida:** (ex.: trivial → qwen2.5-coder:7b)
**Evidência:** (latência, tokens, link de insight)
```

---

## Relação com autonomia

O Autonomy Controller **lê** política em settings + (futuro) summaries deste folder via PLAYBOOK/CLAUDE includes.  
Ele **não** reescreve este folder sozinho enquanto `autonomy.autoApplyPolicy` for `false` (default).

Isso mantém autonomia operacional (routing, fallback) sem mutação silenciosa da memória do repo.
