#!/bin/bash
#
# post-edit-log.sh
#
# PostToolUse hook for Edit/Write operations
# Logs file changes and optionally runs formatters
#
# Exit codes:
#   0 - Success
#   1 - Warning (non-fatal)
#   2 - Error

set -euo pipefail

# Sanitize input by removing control characters and limiting length
# Prevents log injection attacks via embedded newlines/control chars
sanitize_for_log() {
    local input="$1"
    local max_len="${2:-500}"
    # Remove control characters (0x00-0x1F and 0x7F), limit length
    printf '%s' "$input" | tr -d '\000-\037\177' | head -c "$max_len"
}

# Accept $1 argument or fall back to TOOL_INPUT env var
FILE="${1:-${TOOL_INPUT:-}}"

if [[ -z "$FILE" ]]; then
    exit 0
fi

SAFE_FILE=$(sanitize_for_log "$FILE")

# Log to stderr for observability
printf 'EDIT: %s\n' "$SAFE_FILE" >&2

# Session log support
if [[ -n "${HAWAT_SESSION_LOG:-}" ]]; then
    log_dir=$(dirname "${HAWAT_SESSION_LOG}")
    if [[ -d "$log_dir" ]] && [[ -w "$log_dir" ]]; then
        printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SAFE_FILE" >> "$HAWAT_SESSION_LOG"
    fi
fi

# Check if file exists
if [[ ! -f "$FILE" ]]; then
    printf 'INFO: File does not exist (may have been deleted): %s\n' "$SAFE_FILE"
    exit 0
fi

# Determine file type and run appropriate formatter
EXTENSION="${FILE##*.}"

case "$EXTENSION" in
    js|jsx|ts|tsx|json|md|yaml|yml)
        # JavaScript/TypeScript - try prettier
        if command -v npx &> /dev/null; then
            npx prettier --write "$FILE" 2>/dev/null || true
        fi
        ;;
    py)
        # Python - try black
        if command -v black &> /dev/null; then
            black "$FILE" 2>/dev/null || true
        elif command -v python &> /dev/null; then
            python -m black "$FILE" 2>/dev/null || true
        fi
        ;;
    go)
        # Go - gofmt
        if command -v gofmt &> /dev/null; then
            gofmt -w "$FILE" 2>/dev/null || true
        fi
        ;;
    rs)
        # Rust - rustfmt
        if command -v rustfmt &> /dev/null; then
            rustfmt "$FILE" 2>/dev/null || true
        fi
        ;;
esac

# Log the edit to persistent log
LOG_DIR="${HOME}/.hawat/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true

LOG_FILE="${LOG_DIR}/edits.log"
# Sanitize file path before logging to prevent log injection
LOG_ENTRY=$(sanitize_for_log "$FILE")
if [[ -d "$LOG_DIR" && -w "$LOG_DIR" ]]; then
    printf '%s\n' "$(date -Iseconds) | EDIT | $LOG_ENTRY" >> "$LOG_FILE" || true
fi

# Keep log file from growing too large (keep last 1000 lines)
if [[ -f "$LOG_FILE" ]] && [[ "$(wc -l < "$LOG_FILE")" -gt 1000 ]]; then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp" || true
    mv "${LOG_FILE}.tmp" "$LOG_FILE" 2>/dev/null || true
fi

exit 0
