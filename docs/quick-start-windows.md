# OpenClaude: início rápido para Windows

## 1. Instale o Node.js

Instale Node.js LTS (20+ recomendado) e valide no PowerShell:

```powershell
node -v
npm -v
```

## 2. Instale o OpenClaude

```powershell
npm install -g openclaude
openclaude --version
```

## 3. Escolha um provedor

### Opção A: OpenAI

```powershell
$env:OPENAI_API_KEY="sua_chave"
openclaude
```

### Opção B: DeepSeek

```powershell
$env:OPENAI_BASE_URL="https://api.deepseek.com/v1"
$env:OPENAI_API_KEY="sua_chave_deepseek"
$env:OPENAI_MODEL="deepseek-chat"
openclaude
```

### Opção C: Ollama

```powershell
ollama serve
ollama pull llama3.1:8b
$env:OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
$env:OPENAI_API_KEY="ollama"
$env:OPENAI_MODEL="llama3.1:8b"
openclaude
```

### Opção D: LM Studio

```powershell
$env:OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
$env:OPENAI_API_KEY="lmstudio" # opcional/dummy em alguns cenários
openclaude
```

## 4. Se `openclaude` não for encontrado

No PowerShell:

```powershell
npm config get prefix
```

Adicione o diretório de binários globais ao `Path` do Windows e reinicie o terminal.

## 5. Se o provedor falhar

### OpenAI ou DeepSeek

- Revise chave e URL base.
- Teste rede/proxy corporativo.

### Ollama

- Confirme serviço ativo.
- Valide endpoint local (`127.0.0.1:11434`).

### LM Studio

- Garanta que o servidor local está ligado.
- Revise porta configurada.

## 6. Atualizar OpenClaude

```powershell
npm update -g openclaude
```

## 7. Desinstalar OpenClaude

```powershell
npm uninstall -g openclaude
```

## Precisa de setup avançado?

Consulte `docs/advanced-setup.md`.
