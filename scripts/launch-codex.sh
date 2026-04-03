#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_DIR"

export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_MODEL="${OPENAI_MODEL:-codexplan}"

if ! command -v openclaude >/dev/null 2>&1; then
  if [ ! -f "$REPO_DIR/dist/cli.mjs" ]; then
    echo "Local build not found at $REPO_DIR/dist/cli.mjs"
    echo "Run: npx bun run build"
    exit 1
  fi
fi

echo "Launching OpenClaude from: $REPO_DIR"
echo "Using Codex OAuth from: $HOME/.codex/auth.json"
echo "Model: $OPENAI_MODEL"
echo

if [ -f "$REPO_DIR/dist/cli.mjs" ]; then
  exec node "$REPO_DIR/dist/cli.mjs" "$@"
fi

exec openclaude "$@"
