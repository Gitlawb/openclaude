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

REPO_DIR="${OPENCLAUDE_OPENRAG_REPO_DIR:-$HOME/.openclaude/openrag}"
DOCLING_PORT="${OPENCLAUDE_OPENRAG_DOCLING_PORT:-5001}"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export NO_COLOR=1
export RICH_NO_COLOR=1
export FORCE_COLOR=0
export TERM=dumb
if [ ! -d "$REPO_DIR/.git" ]; then
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone --depth 1 https://github.com/langflow-ai/openrag.git "$REPO_DIR"
fi

cd "$REPO_DIR"
uv sync --python 3.13
uv run --python 3.13 python scripts/docling_ctl.py start --port "$DOCLING_PORT"
docker compose up -d
