#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export LANG="${LANG:-C.UTF-8}"

if command -v python3.11 >/dev/null 2>&1; then
  exec python3.11 -m pip install open-webui
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m pip install open-webui
fi

echo "Python 3.11 is recommended for Open WebUI."
exit 1
