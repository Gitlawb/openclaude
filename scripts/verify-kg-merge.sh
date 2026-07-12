#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0

pass()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check() {
  local msg="$1"; shift
  local tmpfile; tmpfile=$(mktemp)
  if "$@" &>"$tmpfile"; then
    rm -f "$tmpfile"; pass "$msg"
  else
    cat "$tmpfile"; rm -f "$tmpfile"; fail "$msg"
  fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "  Verifying memdir-kg-merge refactor"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── 1. File existence ──────────────────────────────────────────────
echo "── 1. File existence ──"

check "vectorIndex.ts exists" test -f src/memdir/vectorIndex.ts
check "autoExtractFacts.ts exists" test -f src/memdir/autoExtractFacts.ts
check "knowledgeGraph.ts exists" test -f src/utils/knowledgeGraph.ts
check "conversationArc.ts exists" test -f src/utils/conversationArc.ts

check "SQLiteProvider.ts is REMOVED" test ! -f src/utils/storage/SQLiteProvider.ts
check "JSONProvider.ts is REMOVED" test ! -f src/utils/storage/JSONProvider.ts
check "storage/ dir is REMOVED" test ! -d src/utils/storage

# ── 2. Build checks ────────────────────────────────────────────────
echo ""
echo "── 2. Build checks ──"

check "knowledgeGraph.ts builds" bun build --no-bundle src/utils/knowledgeGraph.ts
check "conversationArc.ts builds" bun build --no-bundle src/utils/conversationArc.ts
check "vectorIndex.ts builds" bun build --no-bundle src/memdir/vectorIndex.ts
check "autoExtractFacts.ts builds" bun build --no-bundle src/memdir/autoExtractFacts.ts

# ── 3. Feature flags in build.ts ───────────────────────────────────
echo ""
echo "── 3. Feature flags ──"

check "CONVERSATION_ARC=true in build.ts" grep -q "CONVERSATION_ARC: true" scripts/build.ts
check "MULTI_TURN_CONTEXT=true in build.ts" grep -q "MULTI_TURN_CONTEXT: true" scripts/build.ts

# ── 4. No dangling imports ─────────────────────────────────────────
echo ""
echo "── 4. No dangling imports ──"

# These symbols were removed — nothing should import them anymore
check "No addGlobalEntity imports" test "$(rg "import.*addGlobalEntity" src/ --type ts -c | wc -l)" -eq 0
check "No addGlobalRelation imports" test "$(rg "import.*addGlobalRelation" src/ --type ts -c | wc -l)" -eq 0
check "No addGlobalSummary imports" test "$(rg "import.*addGlobalSummary" src/ --type ts -c | wc -l)" -eq 0
check "No addGlobalRule imports" test "$(rg "import.*addGlobalRule" src/ --type ts -c | wc -l)" -eq 0
check "No SQLiteProvider imports" test "$(rg "SQLiteProvider" src/ --type ts -c | wc -l)" -eq 0
check "No JSONProvider imports" test "$(rg "JSONProvider" src/ --type ts -c | wc -l)" -eq 0

# ── 5. Export integrity ────────────────────────────────────────────
echo ""
echo "── 5. Export integrity ──"

# knowledgeGraph.ts must export these (backward compat)
check "knowledgeGraph exports Entity" grep -q "export interface Entity" src/utils/knowledgeGraph.ts
check "knowledgeGraph exports extractKeywords" grep -q "export function extractKeywords" src/utils/knowledgeGraph.ts
check "knowledgeGraph exports getGlobalGraph" grep -q "export function getGlobalGraph" src/utils/knowledgeGraph.ts
check "knowledgeGraph exports getOrchestratedMemory" grep -q "export async function getOrchestratedMemory" src/utils/knowledgeGraph.ts
check "knowledgeGraph exports searchGlobalGraph" grep -q "export async function searchGlobalGraph" src/utils/knowledgeGraph.ts
check "knowledgeGraph exports resetGlobalGraph" grep -q "export function resetGlobalGraph" src/utils/knowledgeGraph.ts

# conversationArc.ts must export these
check "conversationArc exports Goal" grep -q "export interface Goal" src/utils/conversationArc.ts
check "conversationArc exports ConversationArc" grep -q "export interface ConversationArc" src/utils/conversationArc.ts
check "conversationArc exports initializeArc" grep -q "export function initializeArc" src/utils/conversationArc.ts
check "conversationArc exports updateArcPhase" grep -q "export async function updateArcPhase" src/utils/conversationArc.ts
check "conversationArc exports finalizeArcTurn" grep -q "export async function finalizeArcTurn" src/utils/conversationArc.ts
check "conversationArc exports getArcSummary" grep -q "export async function getArcSummary" src/utils/conversationArc.ts
check "conversationArc exports resetArc" grep -q "export function resetArc" src/utils/conversationArc.ts

# vectorIndex.ts must export these
check "vectorIndex exports initMemdirIndex" grep -q "export async function initMemdirIndex" src/memdir/vectorIndex.ts
check "vectorIndex exports searchMemdirIndex" grep -q "export async function searchMemdirIndex" src/memdir/vectorIndex.ts
check "vectorIndex exports rebuildIndex" grep -q "export async function rebuildIndex" src/memdir/vectorIndex.ts

# autoExtractFacts.ts must export extractFactsIntoMemdir
check "autoExtractFacts exports extractFactsIntoMemdir" grep -q "export async function extractFactsIntoMemdir" src/memdir/autoExtractFacts.ts

# ── 6. query.ts integration ────────────────────────────────────────
echo ""
echo "── 6. query.ts integration ──"

# OpenClaude already has the user message hook for updateArcPhase
check "query.ts has updateArcPhase on user messages" grep -q "updateArcPhase" src/query.ts
check "query.ts has multiTurnContext startNewTurn" grep -q "startNewTurn" src/query.ts
check "query.ts has finalizeArcTurn" grep -q "finalizeArcTurn" src/query.ts

# ── 7. knowledge command ──────────────────────────────────────────
echo ""
echo "── 7. knowledge command ──"

check "knowledge.ts exists" test -f src/commands/knowledge/knowledge.ts
check "knowledge command registered" grep -q "knowledge" src/commands.ts

# ── 8. Config ──────────────────────────────────────────────────────
echo ""
echo "── 8. Config ──"

check "knowledgeGraphEnabled in config" grep -q "knowledgeGraphEnabled" src/utils/config.ts

# ── 9. No removed-symbol references in test files ───────────────────
echo ""
echo "── 9. Test file hygiene ──"

check "No test imports addGlobalEntity" test "$(rg "addGlobalEntity" src/ --type ts -g '*.test.ts' -c | wc -l)" -eq 0
check "No test imports loadProjectGraph" test "$(rg "loadProjectGraph" src/ --type ts -g '*.test.ts' -c | wc -l)" -eq 0
check "No test imports getProjectGraphPath" test "$(rg "getProjectGraphPath" src/ --type ts -g '*.test.ts' -c | wc -l)" -eq 0

# ── 10. full production build dry-run ──────────────────────────────
echo ""
echo "── 10. Production build check ──"

# Use bun build to verify the main entry points resolve
if bun build --no-bundle src/query.ts &>/dev/null; then
  pass "query.ts builds (verifies full import chain)"
else
  fail "query.ts builds (verifies full import chain)"
fi

# ── 11. Feature-flag entry path regression ──────────────────────────
echo ""
echo "── 11. Feature-flag entry path regression ──"

# Build a small probe that exercises the feature-flagged entry path
# at runtime, proving the flags are injected and take effect.
build_probe=$(mktemp -d)
trap 'rm -rf "$build_probe"' EXIT

cat > "$build_probe/probe.ts" << 'PROBE'
import { feature } from 'bun:bundle'
if (!feature('CONVERSATION_ARC')) throw new Error('CONVERSATION_ARC is false at build time')
if (!feature('MULTI_TURN_CONTEXT')) throw new Error('MULTI_TURN_CONTEXT is false at build time')
console.log('feature flags OK: CONVERSATION_ARC=true, MULTI_TURN_CONTEXT=true')
PROBE

if bun build "$build_probe/probe.ts" --outdir="$build_probe/out" &>/dev/null && node "$build_probe/out/probe.js" &>/dev/null; then
  pass "feature-flagged probe builds and runs with flags enabled"
else
  fail "feature-flagged probe builds and runs with flags enabled"
fi

# ── 12. TypeScript type check ────────────────────────────────────────
echo ""
echo "── 12. TypeScript type check ──"

check "bun run typecheck passes" bun run typecheck

# ── 13. Test suite ──────────────────────────────────────────────────
echo ""
echo "── 13. Test suite ──"

check "All focused tests pass" bun test src/memdir/vectorIndex.test.ts src/memdir/autoExtractFacts.test.ts src/utils/conversationArc.test.ts src/utils/multiTurnContext.test.ts src/commands/knowledge/knowledge.test.ts

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════════"

exit $FAIL
