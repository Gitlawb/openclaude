#!/usr/bin/env bash
# Install OpenClaude from a git checkout: pack tarball, npm link, global install,
# or refresh from the public registry. Run from repo root or via package.json scripts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "Usage: $0 {pack|link|global|registry|help}" >&2
  echo "  pack     — bun install, npm pack (prepack runs build → .tgz in repo root)" >&2
  echo "  link     — bun install, build, npm link (dev symlink)" >&2
  echo "  global   — bun install, build, npm install -g . (global openclaude from this tree)" >&2
  echo "  registry — npm install -g @gitlawb/openclaude@latest (official publish)" >&2
  echo "  help     — print this message and exit 0" >&2
}

MODE="${1:-}"
case "$MODE" in
help)
  usage
  exit 0
  ;;
"")
  usage
  exit 1
  ;;
pack)
  bun install --frozen-lockfile
  npm pack
  ;;
link)
  bun install --frozen-lockfile
  bun run build
  npm link
  ;;
global)
  bun install --frozen-lockfile
  bun run build
  npm install -g .
  ;;
registry)
  npm install -g @gitlawb/openclaude@latest
  ;;
*)
  usage
  exit 1
  ;;
esac
