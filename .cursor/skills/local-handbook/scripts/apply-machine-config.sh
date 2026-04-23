#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${HOME}/.claude"
cp "${ROOT}/config/mcp.json" "${HOME}/.claude/mcp.json"
cp "${ROOT}/config/mcp.extra-servers.json" "${HOME}/.claude/mcp.extra-servers.json"
if [[ -e "${HOME}/.cursor/mcp.json" && ! -L "${HOME}/.cursor/mcp.json" ]]; then
  echo "Warning: ${HOME}/.cursor/mcp.json exists and is not a symlink; leaving it unchanged."
else
  mkdir -p "${HOME}/.cursor"
  ln -sf "${HOME}/.claude/mcp.json" "${HOME}/.cursor/mcp.json"
fi
echo "Applied MCP configs from repo to ~/.claude and ~/.cursor/mcp.json symlink."
echo "Restart Cursor (or reload MCP) to pick up server changes."
echo "Cursor UI settings: merge keys from config/cursor-user-settings.json into:"
echo "  ~/Library/Application Support/Cursor/User/settings.json"
