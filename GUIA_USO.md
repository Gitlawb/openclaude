# OpenClaude Agent - Guia de Uso

## O que e o OpenClaude

O OpenClaude e um **agente de coding** que roda no terminal. Diferente de um chatbot comum, ele pode:

- Ler, criar e editar arquivos do seu projeto
- Executar comandos no terminal
- Buscar arquivos e conteudo no codigo
- Navegar pela web
- Delegar sub-tarefas para agentes especializados
- Executar tudo em ciclos autonomos ate completar a tarefa

Voce da o objetivo, ele decide quais ferramentas usar e em que ordem.

---

## Pre-requisitos

| Requisito | Versao Minima | Verificar          |
| --------- | ------------- | ------------------ |
| Node.js   | 20+           | `node --version`   |
| Ollama    | qualquer      | `ollama --version` |
| Bun (dev) | 1.3.11+       | `bun --version`    |

O Ollama precisa estar **rodando** antes de iniciar o OpenClaude:

```powershell
ollama serve
```

---

## Inicio Rapido

### 1. Abrir PowerShell e navegar ate o agente

```powershell
cd E:\Agente_OpenClaude
```

### 2. Iniciar o agente

```powershell
# Modo padrao (cloud - qwen3-vl:235b - gratuito)
.\start-ollama.ps1

# Apontar para um projeto especifico
.\start-ollama.ps1 -Project "E:\40.Relatórios de Perícias"
```

### 3. Digitar seu prompt e aguardar

O agente vai ler arquivos, executar comandos e responder de forma autonoma.

---

## Modos de Operacao

### Cloud (padrao) - Gratuito

Usa o modelo `qwen3-vl:235b` nos servidores da Ollama. Melhor opcao para uso diario.

```powershell
.\start-ollama.ps1
.\start-ollama.ps1 -Project "E:\meu-projeto"
```

**Vantagens:** Gratuito, 235B parametros, tool-calling confiavel
**Desvantagens:** Requer internet, possivel latencia

### OpenAI (plano B) - Pago

Usa GPT-4o da OpenAI. Ideal quando o cloud estiver lento ou indisponivel.

```powershell
.\start-ollama.ps1 -Mode openai
.\start-ollama.ps1 -Mode openai -Project "E:\meu-projeto"
```

Na primeira execucao, o script pede a chave da API OpenAI.

**Vantagens:** Altissima qualidade, baixa latencia
**Desvantagens:** Custo ~$2.50/1M tokens de input

### OpenRouter (plano C) - Gratuito ou pago

Usa OpenRouter como roteador para dezenas de modelos (Qwen, Claude, GPT, Gemini, Llama, DeepSeek, etc).
Ideal para usar modelos gratuitos premium ou alternar rapido entre providers pagos.

```powershell
.\start-ollama.ps1 -Mode openrouter                                          # default: Qwen3.6 Plus (free)
.\start-ollama.ps1 -Mode openrouter -Model "anthropic/claude-sonnet-4.5"     # Claude Sonnet
.\start-ollama.ps1 -Mode openrouter -Model "openai/gpt-4o"                   # GPT-4o
.\start-ollama.ps1 -Mode openrouter -Model "google/gemini-2.5-pro"           # Gemini
.\start-ollama.ps1 -Mode openrouter -Model "deepseek/deepseek-chat"          # DeepSeek (barato)
```

Na primeira execucao, o script pede a chave (pegue em https://openrouter.ai/keys) e
cria o arquivo `.env.openrouter` automaticamente. O arquivo fica no gitignore.

**Vantagens:** Uma chave unica para todos os providers, modelos gratuitos disponiveis, billing centralizado
**Desvantagens:** Modelos premium pagos precisam de creditos na conta OpenRouter

**Como selecionar modelo (3 formas):**

1. **Default fixo** - editar `OPENROUTER_DEFAULT_MODEL` em `.env.openrouter`
2. **Override pontual** - usar `-Model "<id>"` na linha de comando
3. **Runtime** - digitar `/model` dentro do agente para trocar sem reiniciar

**Modelos populares:**

| Modelo                 | ID                                       | Custo input (~/1M tok) |
| ---------------------- | ---------------------------------------- | ---------------------- |
| Qwen3.6 Plus (default) | `qwen/qwen3.6-plus:free`                 | **Gratis**             |
| Claude Sonnet 4.5      | `anthropic/claude-sonnet-4.5`            | $3.00                  |
| Claude Opus 4.5        | `anthropic/claude-opus-4.5`              | $15.00                 |
| GPT-4o                 | `openai/gpt-4o`                          | $2.50                  |
| Gemini 2.5 Pro         | `google/gemini-2.5-pro`                  | $1.25                  |
| DeepSeek V3            | `deepseek/deepseek-chat`                 | $0.27                  |
| Llama 3.3 70B          | `meta-llama/llama-3.3-70b-instruct:free` | **Gratis**             |

Lista completa: https://openrouter.ai/models
Dashboard de uso: https://openrouter.ai/activity

### Local (experimental)

Usa modelos locais na GPU (RTX 4090). Modelos ate 14B cabem na VRAM.

```powershell
.\start-ollama.ps1 -Mode local
.\start-ollama.ps1 -Mode local -Model "qwen2.5:14b"
```

> **Aviso:** Modelos locais de 7B-14B **nao funcionam como agentes confiaveis**.
> Eles nao conseguem usar ferramentas (Read, Bash, Edit) de forma consistente
> quando recebem o system prompt complexo do OpenClaude. Util apenas para
> perguntas simples de texto, sem uso de ferramentas.

---

## Exemplos de Uso por Projeto

### Relatorios de Pericias

```powershell
.\start-ollama.ps1 -Project "E:\40.Relatórios de Perícias"
```

Exemplos de prompts:

- "Analise a estrutura de rotas deste projeto FastAPI"
- "Liste os endpoints e o que cada um faz"
- "Encontre possiveis vulnerabilidades de seguranca"
- "Rode os testes e me mostre o resultado"

### Power SQT

```powershell
.\start-ollama.ps1 -Project "E:\0.Projetos_eletricos\1.Otimizacao\power_sqt_3.0"
```

### FinPower

```powershell
.\start-ollama.ps1 -Project "E:\12.Finpower\12.Finpower"
```

### Gerenciador de Projetos

```powershell
.\start-ollama.ps1 -Project "E:\23.Gerenciador de Projetos\23.Gerenciamento_projetos_3.0_atual"
```

---

## Prompts Eficazes

### Entender Codigo

```
Mapeie a arquitetura deste repositorio e explique o fluxo de execucao.
```

```
Encontre os 5 modulos mais criticos e explique por que.
```

### Editar Codigo

```
Adicione validacao de email no formulario de cadastro em app/routes/auth.py
```

```
Refatore o modulo de autenticacao para usar JWT em vez de sessoes.
```

### Debugar

```
Os testes estao falhando. Rode pytest e identifique a causa raiz.
```

```
Trace o erro "ConnectionRefused" e sugira como corrigir.
```

### Revisar

```
Faca code review das mudancas nao commitadas. Priorize bugs e regressoes.
```

### Criar

```
Crie um endpoint POST /api/relatorio/{id}/exportar que gere um PDF do relatorio.
```

---

## Ferramentas Disponiveis ao Agente

| Ferramenta    | O que faz                                              |
| ------------- | ------------------------------------------------------ |
| **Bash**      | Executa comandos no terminal (git, npm, pytest, etc.)  |
| **Read**      | Le arquivos do projeto                                 |
| **Write**     | Cria arquivos novos                                    |
| **Edit**      | Edita arquivos existentes (apenas o trecho modificado) |
| **Grep**      | Busca conteudo dentro de arquivos (regex)              |
| **Glob**      | Busca arquivos por padrao de nome (ex: `**/*.py`)      |
| **Agent**     | Delega sub-tarefas para agentes especializados         |
| **WebSearch** | Busca na web (DuckDuckGo)                              |
| **WebFetch**  | Busca conteudo de uma URL                              |
| **TodoWrite** | Gerencia lista de tarefas durante a execucao           |

---

## Slash Commands (dentro do agente)

| Comando           | Funcao                               |
| ----------------- | ------------------------------------ |
| `/provider`       | Configurar ou trocar provedor de LLM |
| `/model`          | Trocar modelo durante a sessao       |
| `/help`           | Ver ajuda                            |
| `/onboard-github` | Configurar GitHub Models             |

---

## Diagnosticos

```powershell
cd E:\Agente_OpenClaude

# Verificar saude do ambiente
bun run doctor:runtime

# Verificar modelos Ollama carregados e uso de GPU
ollama ps

# Smoke test rapido
bun run smoke

# Diagnostico completo em JSON
bun run doctor:runtime:json
```

---

ollama run kimi-k2.6:nuvem

## Trocar Modelo na Hora

```powershell
# Cloud (235B - agente completo)
ESTA

# Cloud alternativo (355B)
.\start-ollama.ps1 -Model "glm-4.6:cloud"

# OpenAI GPT-4o
.\start-ollama.ps1 -Mode openai -Model "gpt-4o"

# OpenAI GPT-4o mini (mais barato)
.\start-ollama.ps1 -Mode openai -Model "gpt-4o-mini"
```

## .\start-ollama.ps1 -Model "kimi-k2.6:cloud"

## Modelos Disponiveis

### Instalados no Ollama

| Modelo              | Params | Tipo        | Agente? | Uso            |
| ------------------- | ------ | ----------- | ------- | -------------- |
| qwen3-vl:235b-cloud | 235B   | Cloud       | **Sim** | Uso principal  |
| glm-4.6:cloud       | 355B   | Cloud       | Sim     | Alternativa    |
| qwen2.5:14b         | 14.7B  | Local (GPU) | Nao     | Texto simples  |
| qwen2.5:7b          | 7.6B   | Local (GPU) | Nao     | Texto simples  |
| qwen2.5-coder:7b    | 7.6B   | Local (GPU) | Nao     | Codigo simples |
| llama3.1:8b         | 8B     | Local (GPU) | Nao     | Texto simples  |

### Via OpenAI API (requer chave)

| Modelo      | Qualidade | Custo        | Agente? |
| ----------- | --------- | ------------ | ------- |
| gpt-4o      | Excelente | ~$2.50/1M in | **Sim** |
| gpt-4o-mini | Boa       | ~$0.15/1M in | Parcial |

---

## Agent Routing

O OpenClaude pode rotear diferentes tipos de agentes para diferentes modelos.
A configuracao atual em `~/.claude/settings.json`:

```json
{
  "agentModels": {
    "qwen3-vl:235b-cloud": {
      "base_url": "http://localhost:11434/v1",
      "api_key": "ollama"
    },
    "glm-4.6:cloud": {
      "base_url": "http://localhost:11434/v1",
      "api_key": "ollama"
    }
  },
  "agentRouting": {
    "Explore": "qwen3-vl:235b-cloud",
    "Plan": "qwen3-vl:235b-cloud",
    "general-purpose": "qwen3-vl:235b-cloud",
    "default": "qwen3-vl:235b-cloud"
  }
}
```

---

## Arquivos de Configuracao

| Arquivo                    | Localizacao                                     | Funcao                              |
| -------------------------- | ----------------------------------------------- | ----------------------------------- |
| `.env`                     | `E:\Agente_OpenClaude\.env`                     | Variaveis de ambiente do provedor   |
| `.openclaude-profile.json` | `E:\Agente_OpenClaude\.openclaude-profile.json` | Perfil salvo do provedor            |
| `settings.json`            | `C:\Users\User\.claude\settings.json`           | Configuracao global + agent routing |
| `start-ollama.ps1`         | `E:\Agente_OpenClaude\start-ollama.ps1`         | Script de lancamento PowerShell     |
| `start-ollama.sh`          | `E:\Agente_OpenClaude\start-ollama.sh`          | Script de lancamento Bash           |

---

## Solucao de Problemas

### Ollama nao esta rodando

```powershell
ollama serve
```

### Modelo nao encontrado

```powershell
ollama pull qwen3-vl:235b-cloud
```

### Agente nao usa ferramentas (responde texto inventado)

O modelo e pequeno demais. Use modo cloud ou openai:

```powershell
.\start-ollama.ps1                   # cloud (padrao)
.\start-ollama.ps1 -Mode openai      # openai
```

### Resposta muito lenta

Verifique se esta usando GPU:

```powershell
ollama ps
```

Se mostrar `CPU` no campo PROCESSOR, o modelo esta rodando em CPU (lento).

### Erro de conexao com OpenAI

Verifique se a chave esta configurada:

```powershell
echo $env:OPENAI_API_KEY
```

---

## Limiar de Modelos para Agentes

Modelos locais pequenos (7B-14B) **nao funcionam como agentes** neste framework.
O OpenClaude envia um system prompt complexo com dezenas de definicoes de
ferramentas. Modelos pequenos se perdem nesse contexto.

| Parametros        | Funciona como agente?       |
| ----------------- | --------------------------- |
| 7B - 14B          | Nao (alucina respostas)     |
| 30B+              | Parcial (depende do modelo) |
| 70B+              | Sim (nao cabe na 4090)      |
| 200B+ (cloud/API) | **Sim**                     |

Para uso como agente, use sempre **cloud** ou **OpenAI API**.
