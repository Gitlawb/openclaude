#!/bin/bash
#
# error-detector.sh
#
# PostToolUse hook for Bash commands
# Detects and logs errors for pattern analysis
#
# Exit codes:
#   0 - No error detected
#   1 - Error detected and logged
#   2 - Script error

set -euo pipefail

# Get command output and exit code from environment
COMMAND="${TOOL_INPUT:-}"
EXIT_CODE="${TOOL_EXIT_CODE:-0}"
OUTPUT="${TOOL_OUTPUT:-}"

# Directory for error logs
LOG_DIR="${HOME}/.hawat/logs"
mkdir -p "$LOG_DIR"

ERROR_LOG="${LOG_DIR}/errors.log"
PATTERN_LOG="${LOG_DIR}/error-patterns.log"

# Function to log errors
log_error() {
    local error_type="$1"
    local details="$2"
    echo "$(date -Iseconds) | $error_type | $COMMAND | $details" >> "$ERROR_LOG"
}

# Function to update pattern counts
update_pattern() {
    local pattern="$1"
    # Simple pattern counting (append for analysis)
    echo "$(date -Iseconds) | $pattern" >> "$PATTERN_LOG"
}

# Check for non-zero exit code
if [ "$EXIT_CODE" != "0" ]; then
    log_error "EXIT_CODE" "Exit code: $EXIT_CODE"
fi

# Common error patterns to detect
ERROR_PATTERNS=(
    "command not found"
    "permission denied"
    "no such file or directory"
    "module not found"
    "cannot find module"
    "error:"
    "Error:"
    "ERROR:"
    "failed"
    "FAILED"
    "exception"
    "Exception"
    "traceback"
    "Traceback"
    "syntax error"
    "SyntaxError"
    "type error"
    "TypeError"
    "undefined"
    "null pointer"
    "segmentation fault"
    "out of memory"
    "connection refused"
    "timeout"
)

OUTPUT_LOWER=$(echo "$OUTPUT" | tr '[:upper:]' '[:lower:]')

for pattern in "${ERROR_PATTERNS[@]}"; do
    pattern_lower=$(echo "$pattern" | tr '[:upper:]' '[:lower:]')
    if [[ "$OUTPUT_LOWER" == *"$pattern_lower"* ]]; then
        log_error "PATTERN" "$pattern"
        update_pattern "$pattern"
    fi
done

# Keep log files from growing too large
for log in "$ERROR_LOG" "$PATTERN_LOG"; do
    if [ -f "$log" ] && [ "$(wc -l < "$log")" -gt 5000 ]; then
        tail -n 5000 "$log" > "${log}.tmp"
        mv "${log}.tmp" "$log"
    fi
done

exit 0
