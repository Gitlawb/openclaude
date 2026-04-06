# Playbook operacional local do OpenClaude

Este playbook consolida comandos e práticas para uso diário com foco em estabilidade, velocidade e qualidade.

## 1) O que você tem

- CLI OpenClaude
- Perfis locais/cloud
- Diagnósticos de runtime
- Fluxos de qualidade (test/typecheck)

## 2) Início diário (caminho rápido)

```bash
openclaude --version
openclaude
```

Perfis sugeridos:

- **Baixa latência**: modelo menor e local (quando possível).
- **Maior qualidade**: modelo cloud mais robusto.

## 3) Setup inicial (uma vez)

### 3.1 Inicializar perfil local

Defina variáveis ou arquivo de perfil para o provedor principal.

### 3.2 Confirmar arquivo de perfil

Revise se chaves, URL e modelo estão corretos.

### 3.3 Validar ambiente

Rode checks básicos de versão e conectividade.

## 4) Saúde e diagnóstico

### 4.1 Checagens legíveis para humanos

- versão da CLI
- variáveis mínimas
- reachability de endpoint

### 4.2 Diagnóstico JSON (automação/log)

Gere relatórios para CI e troubleshooting repetível.

### 4.3 Persistir relatório de runtime

Armazene resultados em diretórios de `reports/`.

### 4.4 Hardening

Execute smoke checks e validações mais estritas antes de mudanças críticas.

## 5) Modos de provedor

### 5.1 Modo local (Ollama)

Ideal para custo baixo e desenvolvimento offline/privado.

### 5.2 Modo OpenAI

Ideal para maior qualidade e menor configuração local.

## 6) Matriz de troubleshooting

### 6.1 `Script not found "dev"`

Verifique scripts do `package.json` e use comandos suportados pelo repo.

### 6.2 `ollama: term not recognized`

Instale Ollama e confirme binário no `PATH`.

### 6.3 Falha de reachability para localhost

Confirme serviço local ativo e porta correta.

### 6.4 `Missing key for non-local provider URL`

Defina chave de API para provedores remotos.

### 6.5 Erro de placeholder (`SUA_CHAVE`)

Substitua placeholders por valores reais antes de executar.

## 7) Modelos locais recomendados

- `llama3.1:8b` para equilíbrio geral.
- Modelos menores para velocidade.
- Modelos maiores para qualidade (se hardware suportar).

## 8) Biblioteca prática de prompts

### 8.1 Entendimento de código

“Explique este módulo, riscos e pontos de melhoria.”

### 8.2 Refatoração

“Refatore mantendo comportamento e adicione testes.”

### 8.3 Debug

“Analise stack trace e proponha causa raiz.”

### 8.4 Confiabilidade

“Liste cenários de falha e plano de mitigação.”

### 8.5 Modo revisão

“Faça review como staff engineer e priorize achados.”

## 9) Regras de trabalho seguro

- Não versionar segredos.
- Validar comandos destrutivos.
- Priorizar mudanças pequenas e reversíveis.

## 10) Checklist de recuperação rápida

1. Validar variáveis
2. Validar endpoint
3. Trocar para perfil conhecido estável
4. Executar diagnóstico

## 11) Referência de comandos

```bash
# build/test
bun run build
bun run test
bun run typecheck

# execução
openclaude
```

## 12) Critérios de sucesso

- CLI inicia sem erro.
- Provedor responde de forma consistente.
- Fluxo de desenvolvimento permanece reproduzível.
