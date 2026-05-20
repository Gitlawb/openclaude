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

if ! command -v uv >/dev/null 2>&1; then
  "$(dirname "${BASH_SOURCE[0]}")/install-openrag.sh"
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi

WORKSPACE_DIR="${OPENCLAUDE_OPENRAG_WORKSPACE_DIR:-$HOME/.openclaude/openrag-workspace}"
mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"
exec uvx --python 3.13 openrag
