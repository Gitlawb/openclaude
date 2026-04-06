# OpenClaude: início rápido para macOS e Linux

## 1. Instale o Node.js

Use Node.js LTS (recomendado: 20+):

```bash
node -v
npm -v
```

Se não estiver instalado, instale pelo site oficial do Node.js.

## 2. Instale o OpenClaude

```bash
npm install -g openclaude
openclaude --version
```

## 3. Escolha um provedor

### Opção A: OpenAI

```bash
export OPENAI_API_KEY="sua_chave"
openclaude
```

### Opção B: DeepSeek

```bash
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_API_KEY="sua_chave_deepseek"
export OPENAI_MODEL="deepseek-chat"
openclaude
```

### Opção C: Ollama

```bash
ollama serve
ollama pull llama3.1:8b
export OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
export OPENAI_API_KEY="ollama"
export OPENAI_MODEL="llama3.1:8b"
openclaude
```

### Opção D: LM Studio

```bash
export OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
export OPENAI_API_KEY="lmstudio" # opcional/dummy em alguns cenários
openclaude
```

## 4. Se `openclaude` não for encontrado

```bash
npm prefix -g
npm bin -g
```

Adicione o diretório global de binários ao `PATH` no seu shell (`~/.bashrc`, `~/.zshrc`, etc.).

## 5. Se o provedor falhar

### OpenAI ou DeepSeek

- Verifique se a chave está correta.
- Confirme se `OPENAI_BASE_URL` está certo (quando aplicável).

### Ollama

- Confirme se `ollama serve` está ativo.
- Teste `curl http://127.0.0.1:11434/api/tags`.

### LM Studio

- Ative o servidor local na interface do LM Studio.
- Confira se a porta configurada é `1234`.

## 6. Atualizar OpenClaude

```bash
npm update -g openclaude
```

## 7. Desinstalar OpenClaude

```bash
npm uninstall -g openclaude
```

## Precisa de setup avançado?

Consulte `docs/advanced-setup.md`.
