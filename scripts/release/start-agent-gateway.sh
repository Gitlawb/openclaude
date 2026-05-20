#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export LANG="${LANG:-C.UTF-8}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export OPENCLAUDE_AGENT_API_ENABLED="${OPENCLAUDE_AGENT_API_ENABLED:-1}"
export OPENCLAUDE_AGENT_CRON_ENABLED="${OPENCLAUDE_AGENT_CRON_ENABLED:-1}"
if [ -z "${OPENCLAUDE_RESPECT_PROVIDER_ENV:-}" ] && [ -n "${OPENAI_API_KEY:-}" ]; then
  export OPENCLAUDE_RESPECT_PROVIDER_ENV=1
fi

if [ "${OPENCLAUDE_RESPECT_PROVIDER_ENV:-0}" != "1" ]; then
  unset CLAUDE_CODE_USE_OPENAI
  unset CLAUDE_CODE_USE_GEMINI
  unset CLAUDE_CODE_USE_GITHUB
fi

if [ ! -d node_modules ]; then
  ./scripts/release/install-deps.sh
fi

if [ ! -f dist/cli.mjs ]; then
  bun run build
fi

exec bun run start:agent-gateway -- "$@"
