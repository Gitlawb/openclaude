#!/bin/bash
# start-daemons.sh — Start DuckHive integrated daemons
# Auto-starts council daemon, skips if already running

COUNCIL_PORT="${COUNCIL_PORT:-3007}"
COUNCIL_PATH="$(dirname "$0")/../src/services/council-server/council-api-server.cjs"
LOG_DIR="${HOME}/Library/Logs/duckhive"
PID_DIR="${HOME}/Library/Caches/duckhive"

mkdir -p "$LOG_DIR" "$PID_DIR"
COUNCIL_LOG="$LOG_DIR/council.log"
COUNCIL_PIDFILE="$PID_DIR/council.pid"

# Check if already running
if [ -f "$COUNCIL_PIDFILE" ] && kill -0 "$(cat "$COUNCIL_PIDFILE")" 2>/dev/null; then
    # Verify it's actually responding
    if curl -s --max-time 2 "http://localhost:${COUNCIL_PORT}/api/health" > /dev/null 2>&1; then
        echo "Council already running on port $COUNCIL_PORT"
        exit 0
    fi
fi

# Start council daemon
if [ -f "$COUNCIL_PATH" ]; then
    echo "[$(date)] Starting council on port $COUNCIL_PORT" >> "$COUNCIL_LOG"
    PORT=$COUNCIL_PORT node "$COUNCIL_PATH" >> "$COUNCIL_LOG" 2>&1 &
    COUNCIL_PID=$!
    echo $COUNCIL_PID > "$COUNCIL_PIDFILE"
    
    # Wait for it to be ready (up to 10s)
    for i in $(seq 1 20); do
        if curl -s --max-time 2 "http://localhost:${COUNCIL_PORT}/api/health" > /dev/null 2>&1; then
            echo "[$(date)] Council started (PID $COUNCIL_PID)" >> "$COUNCIL_LOG"
            echo "Council started on port $COUNCIL_PORT (PID $COUNCIL_PID)"
            exit 0
        fi
        sleep 0.5
    done
    echo "[$(date)] WARNING: council took too long to start" >> "$COUNCIL_LOG"
fi
