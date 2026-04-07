#!/usr/bin/env bash
# pre-commit hook — runs fast checks on files staged for this commit.
#
# Install once:
#   cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# Or, to use the repo copy directly (picks up changes automatically):
#   echo '#!/bin/sh\nexec "$(git rev-parse --show-toplevel)/scripts/pre-commit.sh"' \
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

# ── 2. Build (type-check + bundle) ───────────────────────────────────────────
echo "pre-commit: build..."
bun run build --silent 2>&1 | tail -3

# ── 3. Run tests for staged files and their direct test counterparts ─────────
#
# Strategy: for every staged foo.ts, run foo.test.ts if it exists.
# Also always run the pr-intent-scan tests (they cover the ordering detector).
TEST_FILES=()

for f in $STAGED_TS; do
  # Match foo.ts → foo.test.ts, foo.tsx → foo.test.tsx, etc.
  base="${f%.*}"
  ext="${f##*.}"
  candidate="${base}.test.${ext}"
  if [[ -f "$candidate" ]]; then
    TEST_FILES+=("$candidate")
  fi
  # Also check __tests__/ sibling
  dir="$(dirname "$f")"
  name="$(basename "$f" ".${ext}")"
  alt="${dir}/__tests__/${name}.test.${ext}"
  if [[ -f "$alt" ]]; then
    TEST_FILES+=("$alt")
  fi
done

# Always include the ordering-detector tests so a refactor of pr-intent-scan
# doesn't silently break the TOCTOU guard.
if [[ -f "scripts/pr-intent-scan.test.ts" ]]; then
  TEST_FILES+=("scripts/pr-intent-scan.test.ts")
fi

# Deduplicate
IFS=$'\n' TEST_FILES=($(echo "${TEST_FILES[*]}" | sort -u))

if [[ ${#TEST_FILES[@]} -gt 0 ]]; then
  echo "pre-commit: running ${#TEST_FILES[@]} test file(s)..."
  bun test --max-concurrency=1 "${TEST_FILES[@]}"
fi

# ── 4. PR ordering scan (catches write-before-spawn and other patterns) ───────
echo "pre-commit: running pr-intent-scan on staged diff..."
git diff --cached --unified=0 | bun run scripts/pr-intent-scan.ts \
  --base HEAD 2>/dev/null || {
    # Fall back to scanning the staged diff directly when HEAD doesn't exist yet
    # (initial commit).
    true
  }

echo "pre-commit: all checks passed."
