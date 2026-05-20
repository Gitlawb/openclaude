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
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export NO_COLOR=1
export RICH_NO_COLOR=1
export FORCE_COLOR=0
export TERM=dumb
if [ ! -f "$REPO_DIR/docker-compose.yml" ]; then
  echo "OpenRAG repo not found: $REPO_DIR"
  exit 0
fi

cd "$REPO_DIR"
docker compose down
uv run --python 3.13 python scripts/docling_ctl.py stop
