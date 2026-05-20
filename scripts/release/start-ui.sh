#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export LANG="${LANG:-C.UTF-8}"

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

exec bun run start -- "$@"
