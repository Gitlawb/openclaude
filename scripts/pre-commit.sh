#!/usr/bin/env bash
# pre-commit hook — mirrors the PR checks CI job locally.
#
# Checks run (in order):
#   1. Smoke  — build + version check (same as CI "Smoke check" step)
#   2. Tests  — paired .test.ts for every staged file + always-run anchor tests
#   3. Scan   — pr-intent-scan ordering detector on the staged diff
#   4. Summary — prints a consistent PR-ready check summary
#
# Install once:
#   cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# Or delegate to the repo copy so it stays up to date automatically:
#   printf '#!/bin/sh\nexec "$(git rev-parse --show-toplevel)/scripts/pre-commit.sh"\n' \
#     > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# ── Tracking vars for summary ─────────────────────────────────────────────────
SMOKE_STATUS="skipped"
TEST_STATUS="skipped"
SCAN_STATUS="skipped"
TEST_COUNT=0
SCAN_FINDINGS=0

# ── 1. Collect staged TypeScript files ───────────────────────────────────────
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.[tj]sx?$' || true)

if [[ -z "$STAGED_TS" ]]; then
  echo "pre-commit: no TypeScript files staged — skipping all checks."
  exit 0
fi

echo "pre-commit: checking $(echo "$STAGED_TS" | wc -l | tr -d ' ') TypeScript file(s)..."

# ── 2. Smoke check (build + version) — required by CI ────────────────────────
echo ""
echo "pre-commit [1/3]: smoke..."
if bun run smoke; then
  SMOKE_STATUS="passed"
else
  SMOKE_STATUS="FAILED"
fi

# ── 3. Module tests for staged files ─────────────────────────────────────────
#
# For every staged foo.ts we collect:
#   a) foo.test.ts          — direct unit test sibling
#   b) __tests__/foo.test.ts — Jest-style sibling
#   c) *foo*.test.ts in same directory (catches foo.inProcess.test.ts etc.)
#
# Always-run anchors:
#   • scripts/pr-intent-scan.test.ts  — TOCTOU ordering detector
echo ""
echo "pre-commit [2/3]: module tests..."
TEST_FILES=()

for f in $STAGED_TS; do
  base="${f%.*}"
  ext="${f##*.}"
  dir="$(dirname "$f")"
  stem="$(basename "$base")"

  candidate="${base}.test.${ext}"
  [[ -f "$candidate" ]] && TEST_FILES+=("$candidate")

  alt="${dir}/__tests__/${stem}.test.${ext}"
  [[ -f "$alt" ]] && TEST_FILES+=("$alt")

  while IFS= read -r -d '' match; do
    TEST_FILES+=("$match")
  done < <(find "$dir" -maxdepth 1 -name "*${stem}*.test.*" -print0 2>/dev/null)
done

for anchor in scripts/pr-intent-scan.test.ts; do
  [[ -f "$anchor" ]] && TEST_FILES+=("$anchor")
done

if [[ ${#TEST_FILES[@]} -gt 0 ]]; then
  IFS=$'\n' read -r -d '' -a TEST_FILES \
    < <(printf '%s\n' "${TEST_FILES[@]}" | sort -u; printf '\0') || true
  TEST_COUNT=${#TEST_FILES[@]}
  echo "pre-commit: running ${TEST_COUNT} test file(s)..."
  if bun test --max-concurrency=1 "${TEST_FILES[@]}"; then
    TEST_STATUS="passed"
  else
    TEST_STATUS="FAILED"
  fi
else
  TEST_STATUS="no tests found"
fi

# ── 4. PR intent scan on staged diff ─────────────────────────────────────────
echo ""
echo "pre-commit [3/3]: pr-intent-scan..."
SCAN_OUTPUT=$(git diff --cached --unified=0 | bun run scripts/pr-intent-scan.ts --base HEAD 2>/dev/null || true)
if echo "$SCAN_OUTPUT" | grep -q "finding(s)"; then
  SCAN_FINDINGS=$(echo "$SCAN_OUTPUT" | grep -oE '[0-9]+ finding' | grep -oE '[0-9]+' || echo "0")
  HIGH=$(echo "$SCAN_OUTPUT" | grep -oE 'high: [0-9]+' | grep -oE '[0-9]+' || echo "0")
  SCAN_STATUS="${SCAN_FINDINGS} finding(s) — ${HIGH} high"
  echo "$SCAN_OUTPUT"
else
  SCAN_STATUS="clean"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║           pre-commit check summary           ║"
echo "╠══════════════════════════════════════════════╣"
printf "║  %-10s  %-31s  ║\n" "smoke"  "$SMOKE_STATUS"
printf "║  %-10s  %-31s  ║\n" "tests"  "$TEST_STATUS (${TEST_COUNT} file(s))"
printf "║  %-10s  %-31s  ║\n" "scan"   "$SCAN_STATUS"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Fail the commit if any required check did not pass
if [[ "$SMOKE_STATUS" == "FAILED" || "$TEST_STATUS" == "FAILED" ]]; then
  echo "pre-commit: one or more checks FAILED — commit blocked."
  exit 1
fi

# Fail on HIGH scan findings (medium findings are advisory)
if echo "$SCAN_OUTPUT" | grep -q "\[HIGH\]"; then
  echo "pre-commit: HIGH severity findings in intent scan — commit blocked."
  exit 1
fi

echo "pre-commit: all checks passed."
