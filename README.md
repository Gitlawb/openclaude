# OpenClaude

OpenClaude é uma interface de terminal (CLI) para conversar com LLMs e automatizar tarefas de desenvolvimento usando múltiplos provedores (OpenAI, Ollama, Codex, LM Studio e outros).

## Por que usar o OpenClaude

- **CLI rápida e produtiva** para coding, debugging e revisão.
- **Suporte a vários provedores** sem trocar de ferramenta.
- **Fluxo local-first** com Ollama e modelos locais.
- **Perfis e roteamento de agente** para escolher o melhor modelo por tarefa.

## Início rápido

### 1) Instalar

```bash
npm install -g openclaude
```

### 2) Iniciar

```bash
openclaude
```

## Configuração rápida de provedor

### OpenAI (mais simples)

```bash
export OPENAI_API_KEY="sua_chave"
openclaude
```

### Ollama local (sem API externa)

```bash
ollama serve
ollama pull llama3.1:8b
export OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
export OPENAI_API_KEY="ollama"
export OPENAI_MODEL="llama3.1:8b"
openclaude
```

## Guias de setup

- `docs/quick-start-mac-linux.md`
- `docs/quick-start-windows.md`
- `docs/non-technical-setup.md`
- `docs/advanced-setup.md`
- `docs/litellm-setup.md`
- `ANDROID_INSTALL.md`

## Provedores suportados

- OpenAI
- Codex (via autenticação ChatGPT quando aplicável)
- Ollama
- LM Studio
- DeepSeek
- Google Gemini (via OpenRouter)
- Together AI
- Groq
- Mistral
- Azure OpenAI
- Atomic Chat (Apple Silicon)

## O que já funciona bem

- Chat interativo no terminal
- Definição dinâmica de provedor/modelo
- Perfis locais de execução
- Diagnóstico de ambiente
- Integração com extensão VS Code

## Notas de provedores

- Alguns provedores exigem `OPENAI_BASE_URL` além de chave.
- Provedores locais podem exigir chave “dummy” (ex.: `ollama`, `lmstudio`).
- Para melhor estabilidade, valide variáveis com os scripts de diagnóstico do projeto.

## Roteamento de agente

O OpenClaude oferece estratégias para direcionar tarefas para modelos diferentes, equilibrando custo, latência e qualidade.

## Busca web e fetch

Quando habilitado, o agente pode usar ferramentas de navegação para enriquecer respostas com fontes externas.

## Servidor gRPC headless

### 1) Iniciar servidor

Use o entrypoint correspondente no projeto para subir o serviço gRPC em modo headless.

### 2) Rodar cliente de teste

Após iniciar o servidor, execute o cliente CLI de teste para validar conectividade e fluxo.

> Dica: consulte o código em `src/server/` para configurações detalhadas de sessão e tipos.

## Build local e desenvolvimento

```bash
bun install
bun run build
bun run test
```

## Testes e cobertura

```bash
bun run test
bun run typecheck
```

## Estrutura do repositório

- `src/`: código principal da CLI
- `docs/`: documentação de setup e operação
- `python/`: provedores/roteadores auxiliares em Python
- `vscode-extension/`: extensão do VS Code

## Extensão VS Code

Veja `vscode-extension/openclaude-vscode/README.md` para instalação e comandos.

## Segurança

Consulte `SECURITY.md` para política de vulnerabilidades e processo de reporte.

## Comunidade e contribuição

- Regras de contribuição: `CONTRIBUTING.md`
- Código de conduta: `CODE_OF_CONDUCT.md`

## Aviso legal

Use modelos e integrações respeitando políticas dos provedores e requisitos legais da sua organização.

## Licença

Este projeto é distribuído sob a licença definida no arquivo `LICENSE`.
