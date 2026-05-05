#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/tmp/openclaude-shim-bench}"
RESULTS="$ROOT/results"
BASE="$ROOT/base"
OFF="$ROOT/off"
MINIFY="$ROOT/minify"

rm -rf "$ROOT"
mkdir -p "$BASE/src" "$BASE/docs" "$BASE/tests" "$RESULTS"

cat >"$BASE/README.md" <<'EOF'
# Shim Live Test Project

This disposable project is used to test OpenClaude workflows against the
OpenAI-compatible shim.

The project exposes a tiny calculator module, a config file, and notes that
mention NanoGPT, DeepSeek, Qwen, and tool schema minimization.

Expected version: 0.4.2
EOF

cat >"$BASE/src/calculator.js" <<'EOF'
export function add(a, b) {
  return a + b
}

export function multiply(a, b) {
  return a * b
}

export function formatResult(label, value) {
  return `${label}: ${value}`
}
EOF

cat >"$BASE/src/config.json" <<'EOF'
{
  "name": "shim-live-test",
  "version": "0.4.2",
  "provider": "nanogpt",
  "defaultModel": "deepseek/deepseek-v4-pro"
}
EOF

cat >"$BASE/docs/notes.md" <<'EOF'
# Notes

- NanoGPT is used through an OpenAI-compatible endpoint.
- DeepSeek V4 Pro is the default model for agentic coding work.
- Qwen models can be used as alternatives.
- Tool schema minimization should preserve all available tools.
EOF

cat >"$BASE/tests/calculator.test.js" <<'EOF'
import { add, multiply, formatResult } from '../src/calculator.js'

if (add(2, 3) !== 5) throw new Error('add failed')
if (multiply(3, 4) !== 12) throw new Error('multiply failed')
if (formatResult('sum', 5) !== 'sum: 5') throw new Error('format failed')

console.log('calculator tests passed')
EOF

cat >"$BASE/package.json" <<'EOF'
{
  "name": "shim-live-test",
  "version": "0.4.2",
  "type": "module",
  "scripts": {
    "test": "node tests/calculator.test.js"
  }
}
EOF

cp -a "$BASE" "$OFF"
cp -a "$BASE" "$MINIFY"

run_case() {
  local mode="$1"
  local workdir="$2"
  local outdir="$3"
  local id="$4"
  local prompt="$5"
  mkdir -p "$outdir"

  printf 'running %s %s\n' "$mode" "$id" >&2
  (
    cd "$workdir"
    OPENAI_SHIM_TOOL_MODE="$mode" \
      timeout 120 openclaude --bare -p --output-format json \
      --permission-mode bypassPermissions \
      --max-budget-usd 0.20 \
      "$prompt"
  ) >"$outdir/${id}.json" 2>"$outdir/${id}.log" || {
    code=$?
    printf '{"type":"harness_error","exit_code":%s,"case":"%s"}\n' "$code" "$id" >>"$outdir/${id}.json"
  }
}

run_suite() {
  local mode="$1"
  local workdir="$2"
  local outdir="$RESULTS/$mode"

  run_case "$mode" "$workdir" "$outdir" "01_arithmetic" "Reply with exactly the number: 4"
  run_case "$mode" "$workdir" "$outdir" "02_read_config" "Read src/config.json and report only the version and defaultModel."
  run_case "$mode" "$workdir" "$outdir" "03_search_deepseek" "Search the project for DeepSeek and report matching file paths only."
  run_case "$mode" "$workdir" "$outdir" "04_run_tests" "Run the test suite with npm test and report pass or fail with the key output."
  run_case "$mode" "$workdir" "$outdir" "05_create_doc" "Create docs/generated-summary.md containing one concise sentence about this project, then report the file path."
  run_case "$mode" "$workdir" "$outdir" "06_edit_code" "Edit src/calculator.js to add an exported subtract(a, b) function, then report what changed."
  run_case "$mode" "$workdir" "$outdir" "07_update_test" "Update tests/calculator.test.js to test subtract(7, 2) === 5, then run npm test and report pass or fail."
  run_case "$mode" "$workdir" "$outdir" "08_summarize_project" "Read README.md and docs/notes.md, then summarize the project in three bullets."
  run_case "$mode" "$workdir" "$outdir" "09_find_version" "Find every occurrence of 0.4.2 in this project and report file paths."
  run_case "$mode" "$workdir" "$outdir" "10_plan_next" "Inspect the project structure and propose the next two engineering tasks. Mention the files you inspected."
}

run_suite off "$OFF"
run_suite minify "$MINIFY"

node - "$RESULTS" <<'NODE'
const fs = require('fs')
const path = require('path')
const root = process.argv[2]

function readRun(mode, id) {
  const file = path.join(root, mode, `${id}.json`)
  const raw = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).at(-1)
  const json = JSON.parse(raw)
  const model = json.modelUsage ? Object.keys(json.modelUsage)[0] : ''
  const usage = model ? json.modelUsage[model] : {}
  return {
    ok: json.type === 'result' && json.subtype === 'success' && !json.is_error,
    input: usage.inputTokens ?? json.usage?.input_tokens ?? 0,
    output: usage.outputTokens ?? json.usage?.output_tokens ?? 0,
    cost: usage.costUSD ?? json.total_cost_usd ?? 0,
    duration: json.duration_ms ?? 0,
    turns: json.num_turns ?? 0,
    result: String(json.result ?? '').replace(/\s+/g, ' ').slice(0, 120),
  }
}

const ids = fs.readdirSync(path.join(root, 'off'))
  .filter(name => name.endsWith('.json'))
  .map(name => name.replace(/\.json$/, ''))
  .sort()

const lines = [
  'case,off_input,minify_input,input_reduction_pct,off_cost,minify_cost,cost_reduction_pct,off_turns,minify_turns,off_ok,minify_ok',
]
let offInput = 0
let minInput = 0
let offCost = 0
let minCost = 0
let offOk = 0
let minOk = 0

for (const id of ids) {
  const off = readRun('off', id)
  const min = readRun('minify', id)
  offInput += off.input
  minInput += min.input
  offCost += off.cost
  minCost += min.cost
  offOk += off.ok ? 1 : 0
  minOk += min.ok ? 1 : 0
  lines.push([
    id,
    off.input,
    min.input,
    ((off.input - min.input) / off.input * 100).toFixed(1),
    off.cost.toFixed(6),
    min.cost.toFixed(6),
    ((off.cost - min.cost) / off.cost * 100).toFixed(1),
    off.turns,
    min.turns,
    off.ok,
    min.ok,
  ].join(','))
}

lines.push([
  'TOTAL',
  offInput,
  minInput,
  ((offInput - minInput) / offInput * 100).toFixed(1),
  offCost.toFixed(6),
  minCost.toFixed(6),
  ((offCost - minCost) / offCost * 100).toFixed(1),
  '',
  '',
  `${offOk}/${ids.length}`,
  `${minOk}/${ids.length}`,
].join(','))

fs.writeFileSync(path.join(root, 'summary.csv'), `${lines.join('\n')}\n`)
console.log(lines.join('\n'))
NODE

printf '\nResults written to %s\n' "$RESULTS"
