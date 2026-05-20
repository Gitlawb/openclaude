#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export LANG="${LANG:-C.UTF-8}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required."
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it first: https://bun.sh"
  exit 1
fi

bun install --frozen-lockfile
echo "Dependencies installed."
