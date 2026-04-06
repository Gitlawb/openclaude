# OpenClaude para pessoas não técnicas

Este guia foi feito para quem quer usar o OpenClaude sem entrar em detalhes de desenvolvimento.

## O que o OpenClaude faz

- Permite conversar com IA no terminal.
- Ajuda em escrita, análise e tarefas técnicas.
- Pode usar modelos na nuvem ou locais.

## Antes de começar

Você precisa de:

- Um computador com macOS, Linux ou Windows.
- Node.js instalado.
- Uma conta/provedor de IA (OpenAI, por exemplo) **ou** Ollama local.

## Caminho mais rápido

1. Instale OpenClaude:
   - `npm install -g openclaude`
2. Configure uma chave da OpenAI:
   - macOS/Linux: `export OPENAI_API_KEY="sua_chave"`
   - Windows: `$env:OPENAI_API_KEY="sua_chave"`
3. Execute: `openclaude`

## Escolha seu sistema operacional

- macOS/Linux: `docs/quick-start-mac-linux.md`
- Windows: `docs/quick-start-windows.md`
- Android/Termux: `ANDROID_INSTALL.md`

## Qual provedor escolher?

### OpenAI

- Mais simples para começar.
- Boa qualidade geral.

### Ollama

- Roda localmente no seu computador.
- Pode reduzir custos recorrentes.
- Requer mais recursos de hardware.

### Codex

- Fluxo voltado para desenvolvimento de software.
- Pode depender de autenticação específica.

## Como saber se deu certo

- O comando `openclaude` abre a interface.
- Você consegue enviar prompt e receber resposta.
- Não há erros de chave inválida/conexão.

## Problemas comuns

### `openclaude` command not found

- Abra novo terminal.
- Verifique instalação global do npm.
- Ajuste o `PATH`.

### Chave de API inválida

- Gere nova chave no provedor.
- Remova espaços extras/caráteres ocultos.

### Ollama não funciona

- Inicie `ollama serve`.
- Confira se o modelo foi baixado com `ollama pull`.

## Quer mais controle?

Consulte `docs/advanced-setup.md` para perfis, roteamento e diagnósticos.
