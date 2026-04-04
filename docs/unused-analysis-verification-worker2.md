# Worker 2 verification: unused code/imports analysis

Date: 2026-04-04
Role: analyze / verification

## Scope

Leader clarification changed task-2 to analysis-only verification. No feature implementation was required.

## Commands run

1. `bun install --frozen-lockfile`
   - PASS: installed the repo's locked dependencies in this worktree.
2. `bun run typecheck`
   - FAIL (baseline repo blocker): the repository does not typecheck cleanly, so a full-project compiler-only unused-symbol pass is too noisy to use as a final oracle.
3. Search / file inspection with `rg` + targeted file reads.
   - PASS: enough to confirm a small set of strong candidates and separate obvious false positives.

## Strongest confirmed candidates

### 1) `src/assistant/AssistantSessionChooser.tsx`
- The file is a stub that imports `React` and returns `null`.
- Search evidence: `React` appears only on the import line.
- This is a strong candidate for removing the default `React` import.

Snippet summary:
- `import React from 'react'`
- exported stub component returns `null`
- no other `React` references in file

### 2) `src/utils/toolPool.ts`
- `mergeAndFilterTools(..., mode)` declares a `mode` parameter.
- Search evidence: `mode` appears only in the JSDoc and the function signature, not in executable logic.
- This is a strong candidate for deleting the parameter or renaming it to an intentional-underscore form if the call signature must stay stable.

## Notable false positives / intentional unuseds

### A) `src/ink/components/App.tsx`
- `processKeysInBatch(app, items, _unused1, _unused2)` intentionally keeps two placeholder params.
- Nearby comment explicitly says the callback shape must match `discreteUpdates(fn, a, b, c, d)`.
- Conclusion: this is not a good cleanup candidate unless the upstream callback contract changes.

### B) `src/vim/operators.ts`
- `getOperatorRangeForFind(..., _findType)` is documented as intentionally unused.
- Nearby comment explains `Cursor.findCharacter` already adjusts the offset for `t/T` motions.
- Conclusion: not a real unused-code bug; the underscore is intentional and documented.

### C) grep-only text hits are not evidence
The following are grep false positives for the word `unused` because they occur in prose/comments/strings rather than as actionable unused symbols:
- `src/constants/prompts.ts`
- `src/services/mcp/claudeai.ts`
- `src/ink/ink.tsx`
- `src/tools/FileEditTool/FileEditTool.ts`
- `src/tools/FileWriteTool/FileWriteTool.ts`

## Blockers

- `bun run typecheck` fails with many pre-existing unrelated TypeScript errors in this snapshot, so a repo-wide `tsc --noUnusedLocals --noUnusedParameters` run is not a clean verifier.
- Because of that baseline noise, targeted search/inspection was the most reliable verification path available in this worker lane.

## Recommendation to leader

If only low-risk, high-confidence cleanup is desired right now, the safest first removals are:
1. `React` default import in `src/assistant/AssistantSessionChooser.tsx`
2. Unused `mode` parameter in `src/utils/toolPool.ts`

The intentional underscore-prefixed parameters above should be left alone unless their surrounding APIs are refactored.
