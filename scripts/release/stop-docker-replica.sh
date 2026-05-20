#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8741}"
NAME="${2:-openclaude-agent-${PORT}}"
docker rm -f "$NAME"
