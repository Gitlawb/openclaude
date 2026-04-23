#!/bin/bash
# ============================================================
# OpenClaude + Ollama - Script de Lancamento (Bash/Git Bash)
# ============================================================
# Uso:
#   ./start-ollama.sh                         → modelo padrao
#   ./start-ollama.sh qwen2.5-coder:7b        → modelo especifico
#   PROJETO=/e/meu-projeto ./start-ollama.sh   → abrir em diretorio
# ============================================================

MODEL="${1:-qwen2.5:7b}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_API_KEY=ollama
export OPENAI_MODEL="$MODEL"

# Verificar Ollama
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Iniciando Ollama..."
    ollama serve &>/dev/null &
    sleep 3
fi

echo ""
echo "=== OpenClaude + Ollama ==="
echo "Modelo: $MODEL"
echo "Endpoint: $OPENAI_BASE_URL"
echo ""

# Navegar para projeto se especificado
if [ -n "$PROJETO" ] && [ -d "$PROJETO" ]; then
    cd "$PROJETO"
    echo "Projeto: $PROJETO"
fi

node "$SCRIPT_DIR/dist/cli.mjs"
