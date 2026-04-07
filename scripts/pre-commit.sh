#!/usr/bin/env bash
# pre-commit hook — mirrors the PR checks CI job locally.
#
# Checks run (in order):
#   1. Smoke  — build + version check (same as CI "Smoke check" step)
#   2. Tests  — paired .test.ts for every staged file + always-run anchor tests
#   3. Scan   — pr-intent-scan ordering detector on the staged diff
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

# ── 1. Collect staged TypeScript files ───────────────────────────────────────
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.[tj]sx?$' || true)

if [[ -z "$STAGED_TS" ]]; then
  exit 0  # Nothing TypeScript-related staged — skip all checks.
fi

echo "pre-commit: checking $(echo "$STAGED_TS" | wc -l | tr -d ' ') TypeScript file(s)..."

# ── 2. Smoke check (build + version) — required by CI ────────────────────────
echo "pre-commit: smoke..."
bun run smoke

# ── 3. Module tests for staged files ─────────────────────────────────────────
#
# For every staged foo.ts we collect:
#   a) foo.test.ts   — the direct unit test sibling
#   b) __tests__/foo.test.ts — Jest-style sibling
#   c) Any test file in the same directory whose name contains the module stem
#      (e.g. staging spawnMultiAgent.ts also picks up spawnMultiAgent.inProcess.test.ts)
#
# Always-run anchors (CI-critical tests that must never silently break):
#   • scripts/pr-intent-scan.test.ts  — covers the TOCTOU ordering detector
TEST_FILES=()

for f in $STAGED_TS; do
  base="${f%.*}"
  ext="${f##*.}"
  dir="$(dirname "$f")"
  stem="$(basename "$base")"

  # a) Direct sibling: foo.test.ts
  candidate="${base}.test.${ext}"
  [[ -f "$candidate" ]] && TEST_FILES+=("$candidate")

  # b) __tests__/ sibling
  alt="${dir}/__tests__/${stem}.test.${ext}"
  [[ -f "$alt" ]] && TEST_FILES+=("$alt")

  # c) All test files in the same directory whose name contains the module stem
  #    Catches foo.inProcess.test.ts, foo.integration.test.ts, etc.
  while IFS= read -r -d '' match; do
    TEST_FILES+=("$match")
  done < <(find "$dir" -maxdepth 1 -name "*${stem}*.test.*" -print0 2>/dev/null)
done

# Always-run anchor tests
for anchor in scripts/pr-intent-scan.test.ts; do
  [[ -f "$anchor" ]] && TEST_FILES+=("$anchor")
done

# Deduplicate while preserving order
if [[ ${#TEST_FILES[@]} -gt 0 ]]; then
  IFS=$'\n' read -r -d '' -a TEST_FILES \
    < <(printf '%s\n' "${TEST_FILES[@]}" | sort -u; printf '\0') || true
  echo "pre-commit: running ${#TEST_FILES[@]} test file(s)..."
  bun test --max-concurrency=1 "${TEST_FILES[@]}"
fi

# ── 4. PR intent scan on staged diff ─────────────────────────────────────────
echo "pre-commit: running pr-intent-scan on staged diff..."
git diff --cached --unified=0 | bun run scripts/pr-intent-scan.ts --base HEAD 2>/dev/null || true

echo "pre-commit: all checks passed."
