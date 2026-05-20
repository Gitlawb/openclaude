#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export LANG="${LANG:-C.UTF-8}"
export PYTHONUTF8="${PYTHONUTF8:-1}"
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"
export WEBUI_AUTH="${WEBUI_AUTH:-False}"

if [ -z "${OPENCLAUDE_AGENT_API_PORT:-}" ] && [ -f "$HOME/.openclaude/agent-gateway.json" ]; then
  OPENCLAUDE_AGENT_API_PORT="$(node -e "try{const c=require(process.env.HOME+'/.openclaude/agent-gateway.json'); process.stdout.write(String(c.api?.port||''))}catch{}" 2>/dev/null || true)"
fi

OPENCLAUDE_AGENT_API_HOST="${OPENCLAUDE_AGENT_API_HOST:-127.0.0.1}"
OPENCLAUDE_AGENT_API_PORT="${OPENCLAUDE_AGENT_API_PORT:-8642}"

if [ -z "${OPENCLAUDE_AGENT_API_KEY:-}" ] && [ -f "$HOME/.openclaude/agent-gateway.json" ]; then
  OPENCLAUDE_AGENT_API_KEY="$(node -e "try{const c=require(process.env.HOME+'/.openclaude/agent-gateway.json'); process.stdout.write(String(c.api?.apiKey||''))}catch{}" 2>/dev/null || true)"
fi

export OPENAI_API_BASE_URLS="${OPENAI_API_BASE_URLS:-http://${OPENCLAUDE_AGENT_API_HOST}:${OPENCLAUDE_AGENT_API_PORT}/v1}"
export OPENAI_API_KEYS="${OPENAI_API_KEYS:-${OPENCLAUDE_AGENT_API_KEY:-openclaude-local}}"
echo "Open WebUI: http://localhost:8080"
exec open-webui serve --host localhost --port 8080
