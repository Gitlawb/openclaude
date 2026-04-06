# OpenClaude: configuração avançada

Este guia reúne opções para ambientes profissionais: múltiplos provedores, perfis, diagnósticos e hardening.

## Opções de instalação

### Opção A: npm

```bash
npm install -g openclaude
```

### Opção B: build do código-fonte (Bun)

```bash
git clone <repo>
cd openclaude
bun install
bun run build
```

### Opção C: execução direta com Bun

```bash
bun run src/entrypoints/cli.tsx
```

## Exemplos de provedores

### OpenAI

```bash
export OPENAI_API_KEY="sua_chave"
export OPENAI_MODEL="gpt-4o-mini"
```

### Codex via autenticação ChatGPT

Se aplicável ao seu ambiente, use o arquivo de autenticação local (ex.: `~/.codex/auth.json`) e o perfil correspondente.

### DeepSeek

```bash
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_API_KEY="sua_chave"
export OPENAI_MODEL="deepseek-chat"
```

### Gemini via OpenRouter

```bash
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_API_KEY="sua_chave_openrouter"
export OPENAI_MODEL="google/gemini-2.0-flash-001"
```

### Ollama

```bash
export OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
export OPENAI_API_KEY="ollama"
export OPENAI_MODEL="llama3.1:8b"
```

### Atomic Chat (local, Apple Silicon)

Use endpoint local do Atomic Chat e ajuste modelo conforme o runtime detectado.

### LM Studio

```bash
export OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
export OPENAI_API_KEY="lmstudio"
```

### Together AI / Groq / Mistral / Azure OpenAI

Todos podem ser configurados no padrão OpenAI-compatível, com `OPENAI_BASE_URL`, `OPENAI_API_KEY` e `OPENAI_MODEL`.

## Variáveis de ambiente úteis

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENCLAUDE_*` (se aplicável no seu fluxo interno)

## Hardening de runtime

### Sanidade de inicialização

```bash
openclaude --version
```

### Validação de ambiente/provedor

Use os comandos de diagnóstico do projeto para validar chave, URL, modelo e conectividade.

### Diagnóstico em JSON

Gere relatório legível por automação para CI/logging quando disponível.

### Persistência de relatório

Salve artefatos em `reports/` para auditoria local.

## Perfis de execução

Perfis simplificam alternância entre local/cloud e cenários de custo/latência.

Exemplos típicos:

- Perfil local (Ollama)
- Perfil OpenAI
- Perfil Codex
- Perfil híbrido com fallback

## Matriz rápida de problemas

- **Erro de chave ausente:** defina `OPENAI_API_KEY`.
- **Falha de reachability local:** confirme serviço local e porta.
- **Modelo inválido:** troque para modelo disponível no provedor.
- **Latência alta:** use perfil “rápido” com modelo menor.

## Boas práticas

- Use `.env` local (não versionar segredos).
- Mantenha perfis com nomes semânticos (ex.: `local-fast`, `cloud-quality`).
- Rode checks de build/test antes de atualizar perfis em equipe.
