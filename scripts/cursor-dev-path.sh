#!/usr/bin/env bash
# Prepends common install locations so Bun (and other tools) resolve when VS Code /
# Cursor launches tasks with a minimal PATH (common on macOS GUI sessions).
set -euo pipefail
export PATH="${HOME}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/share/mise/shims:${PATH}"
exec "$@"
