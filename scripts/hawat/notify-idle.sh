#!/bin/bash
#
# notify-idle.sh
#
# Stop hook for session idle detection
# Notifies about idle state and optionally saves context
#
# Exit codes:
#   0 - Success

set -euo pipefail

# Get stop reason from environment
STOP_REASON="${STOP_REASON:-unknown}"

# Directory for state
STATE_DIR="${HOME}/.hawat/state"
mkdir -p "$STATE_DIR"

# Timestamp file
LAST_ACTIVITY="${STATE_DIR}/last-activity"

# Record stop event
echo "$(date -Iseconds) | STOP | $STOP_REASON" >> "${STATE_DIR}/session-stops.log"

# If this is an idle stop, we might want to save context
if [[ "$STOP_REASON" == *"idle"* ]] || [[ "$STOP_REASON" == *"timeout"* ]]; then
    # Check if there's a checkpoint to preserve
    CHECKPOINT="${PWD}/.claude/checkpoint.md"
    if [ -f "$CHECKPOINT" ]; then
        # Copy checkpoint to state directory for recovery
        cp "$CHECKPOINT" "${STATE_DIR}/last-checkpoint.md"
        echo "INFO: Checkpoint saved for recovery"
    fi
fi

# Update last activity time
echo "$(date -Iseconds)" > "$LAST_ACTIVITY"

# Clean up old session stop logs (keep last 100 entries)
STOP_LOG="${STATE_DIR}/session-stops.log"
if [ -f "$STOP_LOG" ] && [ "$(wc -l < "$STOP_LOG")" -gt 100 ]; then
    tail -n 100 "$STOP_LOG" > "${STOP_LOG}.tmp"
    mv "${STOP_LOG}.tmp" "$STOP_LOG"
fi

exit 0
