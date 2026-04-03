#!/bin/zsh

set -euo pipefail

patterns=(
  'openclaude'
  'dist/cli.mjs'
  'bin/openclaude'
)

pids=()

for pattern in "${patterns[@]}"; do
  while IFS= read -r pid; do
    [[ -n "${pid:-}" ]] && pids+=("$pid")
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
done

if [[ ${#pids[@]} -eq 0 ]]; then
  echo "No OpenClaude processes found."
  exit 0
fi

unique_pids=($(printf "%s\n" "${pids[@]}" | sort -u))

echo "Stopping OpenClaude processes: ${unique_pids[*]}"
kill "${unique_pids[@]}" 2>/dev/null || true
sleep 1

remaining=()
for pid in "${unique_pids[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    remaining+=("$pid")
  fi
done

if [[ ${#remaining[@]} -gt 0 ]]; then
  echo "Force stopping remaining processes: ${remaining[*]}"
  kill -9 "${remaining[@]}" 2>/dev/null || true
fi

echo "OpenClaude stop command finished."
