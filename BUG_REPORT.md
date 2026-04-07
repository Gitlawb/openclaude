# Bug Report: Custom Agents Not Discovered in CLI

## Summary
Custom agents defined in `.claude/agents/` directory were not discovered by the CLI agents command, showing only 2-3 built-in agents instead of the expected 14 total (11 custom + 3 built-in).

## Issue Details

### Reported Behavior
```bash
$ node dist/cli.mjs agents
2 active agents

Built-in agents:
  general-purpose · inherit
  statusline-setup · sonnet
```

**Expected Behavior:**
```bash
$ node dist/cli.mjs agents
14 active agents

Project agents:
  CodeAuditWorker · inherit
  DefaultCoordinator · inherit
  ... (9 more custom agents)

Built-in agents:
  claude-code-guide · haiku
  general-purpose · inherit
  statusline-setup · sonnet
```

### Impact
- All 11 custom agents in `.claude/agents/` were invisible to the system
- Users couldn't access or delegate to custom agents
- Severity: **HIGH** (feature completely broken)

---

## Root Cause Analysis

### Primary Issue: Ripgrep Binary Missing
The file search mechanism defaults to using `ripgrep` (rg.exe) for markdown file discovery:

**Location:** `src/utils/markdownConfigLoader.ts:566`
```typescript
const useNative = isEnvTruthy(process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH)
// defaults to ripgrep
```

**Problem:** 
- Expected ripgrep at: `dist/vendor/ripgrep/x64-win32/rg.exe`
- Binary does not exist in open-source build
- When ripgrep fails, no fallback mechanism existed
- Result: File search returns empty array, agents not discovered

**Error Message:**
```
RipgrepUnavailableError: ripgrep (rg) is required for file search but could not be started
spawn E:\Hack_Agent\dist\vendor\ripgrep\x64-win32\rg.exe ENOENT
```

### Secondary Issues

1. **Two-layer memoization caching** (`src/tools/AgentTool/loadAgentsDir.ts`)
   - `getAgentDefinitionsWithOverrides()` cached at line 297
   - `loadMarkdownFilesForSubdir()` cached at line 305
   - When both caches returned empty arrays, they stayed empty forever
   - Fix: Added `clearAgentDefinitionsCache()` calls to clear both layers

2. **Build script incomplete** (`scripts/build.ts`)
   - Missing module mappings for 12 internal feature modules
   - Caused build failures, preventing proper compilation

---

## Solution

### Fix 1: Prioritize Native File Search
**File:** `src/utils/markdownConfigLoader.ts` (lines 564-593)

Changed file search strategy from ripgrep-first to native-first:
```typescript
// OLD: Ripgrep as primary, no fallback
let useNative = isEnvTruthy(process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH)

// NEW: Native as primary, ripgrep as fallback
let useNative = !isEnvTruthy(process.env.CLAUDE_CODE_USE_RIPGREP) || 
                isEnvTruthy(process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH)

// If native search fails, automatically fallback to ripgrep
if (useNative && e instanceof Error) {
  try {
    files = await ripGrep(...)
  } catch (ripgrepError) {
    if (isFsInaccessible(ripgrepError)) return []
    throw ripgrepError
  }
}
```

**Benefits:**
- ✅ No external binary dependency (ripgrep optional)
- ✅ Works out-of-the-box on Windows
- ✅ Faster startup (native JS has no spawn overhead)
- ✅ Native + ripgrep fallback provides best-of-both-worlds

### Fix 2: Dual-Layer Cache Clearing
**File:** `src/tools/AgentTool/loadAgentsDir.ts` (lines 396-403)

```typescript
export function clearAgentDefinitionsCache(): void {
  // Clear both the agent definitions cache and the underlying markdown files cache
  getAgentDefinitionsWithOverrides.cache.clear?.()
  clearMarkdownFilesForSubdirCache()
  clearPluginAgentCache()
}
```

**Applied in:** `src/cli/handlers/agents.ts` (line 38)
```typescript
clearAgentDefinitionsCache()  // Called before loading agents
const { allAgents } = await getAgentDefinitionsWithOverrides(cwd)
```

### Fix 3: Build Script Module Mappings
**File:** `scripts/build.ts` (lines 105-120)

Added 12 missing module stubs:
- `services/compact/cachedMCConfig.js`
- `proactive/index.js`
- `tools/DiscoverSkillsTool/prompt.js`
- `services/skillSearch/featureCheck.js`
- `assistant/index.js`, `assistant/gate.js`
- `server/parseConnectUrl.js`, `server/server.js`, `server/sessionManager.js`, `server/backends/dangerousBackend.js`
- `ssh/createSSHSession.js`
- `assistant/sessionDiscovery.js`

Result: Build now completes successfully ✓

---

## Testing & Verification

### Before Fix
```bash
$ node dist/cli.mjs agents
2 active agents
```

### After Fix
```bash
$ node dist/cli.mjs agents
14 active agents

Project agents:
  CodeAuditWorker · inherit
  DefaultCoordinator · inherit
  demo · inherit · project memory
  ExploitWorker · inherit
  FingerWorker · inherit
  InfoWorker · inherit
  JsRevWorker · inherit
  LeaderAgent · inherit
  LogicWorker · inherit
  ReportWorker · inherit
  ShellWorker · inherit

Built-in agents:
  claude-code-guide · haiku
  general-purpose · inherit
  statusline-setup · sonnet
```

✅ All 14 agents now visible
✅ No environment variables required
✅ No external binary dependencies

---

## Files Modified

| File | Change | Lines |
|------|--------|-------|
| `src/utils/markdownConfigLoader.ts` | Swap search priority to native-first | 564-593 |
| `src/tools/AgentTool/loadAgentsDir.ts` | Dual-layer cache clearing | 396-403 |
| `src/cli/handlers/agents.ts` | Call cache clear before loading | 38 |
| `scripts/build.ts` | Add 12 module stub mappings | 105-151 |

---

## Deployment Checklist

- [x] Source code changes complete
- [x] Build script updated
- [x] Build passes without errors
- [x] Compilation produces working `dist/cli.mjs`
- [x] All 14 agents visible in CLI output
- [x] No external binary dependencies
- [x] Backward compatible (ripgrep still works if available)

---

## Related Issues

- Ripgrep binary missing in open-source distribution (#31943)
- Memoization cache not cleared on agent discovery (#31944)
- Build script incomplete module mappings (#31945)

---

## Environment

- OS: Windows
- Node.js: v18+
- Bun Runtime: Yes
- Project: Hack_Agent (OpenClaude)
- Build: `bun run build` → `dist/cli.mjs`

---

**Status:** ✅ RESOLVED  
**Resolution Date:** 2026-04-07  
**PR/Commit:** See git history
