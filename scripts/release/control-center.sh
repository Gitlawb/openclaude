#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export LANG="${LANG:-C.UTF-8}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required to run OpenClaude Control Center." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  ./scripts/release/install-deps.sh
fi

exec node scripts/release/control-center.mjs "$@"
