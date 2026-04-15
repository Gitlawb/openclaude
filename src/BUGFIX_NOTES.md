# Bug Fix Reference — Developer Notes

Quick-reference for the bug fixes applied in PR #697. See `/BUGS_README.md` for the full audit and `/FIXES.md` for detailed fix descriptions.

---

## File-by-File Summary

### `src/services/api/withRetry.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #54 | Infinite loop: `attempt = maxRetries` → `attempt = maxRetries - 1` | ~527 |
| #55 | 529 detection: added `isOverloadedErrorMessage()` with JSON parse fallback | ~640 |
| #56 | Retry-After: added `Date.parse()` for HTTP-date format | ~851 |
| #58 | Fallback cascade: reset `consecutive529Errors = 0` on fallback trigger | ~357 |

**Watch out for:** The persistent retry loop uses a separate `persistentAttempt` for backoff. The `attempt` counter is just for the for-loop bound.

### `src/query.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #48 | Added `...toolResults` to max_tokens recovery state | ~1130 |
| #49 | Reset `continuationNudgeCount` on `stop_hook_blocking` | ~1090 |
| #52 | Wrapped `pendingToolUseSummary` await in try/catch | ~1090 |

**Watch out for:** The query loop has multiple recovery paths (max_tokens, streaming fallback, stop_hook). Each path constructs `state` differently.

### `src/services/tools/StreamingToolExecutor.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #62 | Added `discarded` check before executing queued tools | ~251 |
| #59 | Added warning log for dropped context modifiers | ~490 |
| #60 | Preserved all sibling error descriptions | ~280 |
| #61 | Added 30s timeout for `progressAvailableResolve` | ~476 |
| #75 | Added 5-minute global tool execution timeout | new |

**Watch out for:** `discard()` and `executeTool()` can race. The `discarded` flag must be checked AFTER dequeuing but BEFORE executing.

### `src/tools/shared/spawnMultiAgent.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #37 | Added `withTeamFileLock()` async mutex for TOCTOU prevention | ~70 |
| #38 | Changed `--model value` to `--model=value` for shell parsing | ~250, ~520 |

**Watch out for:** The mutex is module-scoped. It serializes ALL team file operations, not just the one that triggered the bug. This is intentional — team file writes are rare and fast.

### `src/tools/BashTool/bashPermissions.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #5 | Added 18 interpreter commands to `BARE_SHELL_PREFIXES` | ~202 |

**Watch out for:** The `BARE_SHELL_PREFIXES` set prevents auto-approve rules. Any command in this set requires explicit user approval even if a broad prefix rule like `Bash(cmd:*)` exists.

### `src/tools/FileReadTool/FileReadTool.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #32 | Added `MAX_FILE_READ_LISTENERS = 100` limit | new const |
| #33 | Throw error instead of returning uncompressed image | ~1170 |
| #34 | Added `ELOOP` error handling | ~error handler |
| #35 | Removed `Math.floor(stats.mtimeMs)` precision loss | ~dedup logic |

### `src/tools/FileEditTool/FileEditTool.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #8 | `MAX_EDIT_FILE_SIZE`: 1 GiB → 256 MiB | const |
| #9 | Added `trimEnd()` check for no-op edits | ~validation |
| #10 | Changed `.catch(() => {})` to `.catch(err => logError(err))` | ~418 |

### `src/tools/SkillTool/SkillTool.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #28 | `remoteSkillModules!` → `remoteSkillModules?.` (6 locations) | 141, 391, 395, 506, 619, 673 |
| #30 | Added `hooks`, `allowedTools` to `SAFE_SKILL_PROPERTIES` | ~safe props |

### `src/skills/loadSkillsDir.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #24 | Batched concurrent walks (max 16) | ~401 |
| #23 | Added `MAX_CONDITIONAL_SKILLS = 500` limit | ~conditional map |

### `src/skills/bundledSkills.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #40 | Reset extraction promise on failure for retry | ~66 |
| #41 | Added resolved-path `startsWith(baseDir)` check | ~path validation |
| #26 | Added duplicate skill name warning | ~register |

### `src/tools/WebFetchTool/WebFetchTool.ts`

| Bug | Change | Lines |
|-----|--------|-------|
| #16 | Replaced `process.env.FIRECRAWL_API_KEY!` with null check | ~30 |
| #42 | Sanitized redirect URL in output message | ~redirect handler |

### Other Files

| File | Bug | Change |
|------|-----|--------|
| `AgentTool.tsx` | #12 | Cleanup timeout 1s → 5s + error logging |
| `runAgent.ts` | #11 | Log when provider override changes model |
| `runAgent.ts` | #14 | Merge `allowedTools` with session rules |
| `errors.ts` | #76 | Added `errorDetails` fallback check |
| `errorUtils.ts` | #77 | Increased error depth from 5 → 10 |
| `REPL.tsx` | #63 | Added `useEffect` cleanup for timer interval |
| `REPL.tsx` | #64 | Added error logging for attachment failures |
| `REPL.tsx` | #65 | Added `.length > 0` guards for queue access |
| `main.tsx` | #67, #68 | Changed `.catch(() => {})` to `.catch(err => log(...))` |
| `QueryEngine.ts` | #72 | `snipProjection!` → `snipProjection?.` |
| `CronCreateTool.ts` | #45 | Added minimum 1-minute interval check |
| `ConfigTool.ts` | #47 | Added `MAX_CONFIG_VALUE_LENGTH = 100_000` |
| `PowerShellTool.tsx` | #21 | Fixed fragile `setTimeout` argument pattern |

---

## Adding New Bugs

If you find a new bug during development:

1. Add it to `BUGS_README.md` with the next sequential number
2. Classify severity: 🔴 Critical / 🟡 Medium / 🟢 Low
3. Fix it in the appropriate source file
4. Add a test in `bugfixes.test.ts`
5. Update `FIXES.md` with the fix description
6. Update the summary table in `README.md`
