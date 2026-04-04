# Unused code audit — 2026-04-04

## Scope
Analysis-only report for task-3: identify concrete unused-code / unused-import candidates, separate likely-intentional placeholders from cleanup targets, and suggest cleanup order.

## Evidence used
### Filtered compiler pass
```sh
timeout 60s bash -lc 'bunx --package typescript tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false --ignoreDeprecations 6.0 2>&1 | rg "TS6133|TS6192|TS6196"'
```

This filtered pass surfaced **636 unused diagnostics**:
- **311 × TS6133** — declared value/parameter/import never read
- **319 × TS6196** — declared type never used
- **6 × TS6192** — entire import declaration unused

Largest clusters from the filtered output:
- `src/components`: 470
- `src/commands`: 51
- `src/hooks`: 29
- `src/utils`: 20
- `src/screens`: 12
- `src/ink`: 12

### Manual spot checks
I also spot-checked files with either explicit unused/dead-code comments or high-confidence compiler hits to distinguish low-risk cleanup from intentional compatibility placeholders.

## High-confidence cleanup candidates
These look safe to clean up first because the evidence is direct and localized.

| File | Candidate | Evidence | Confidence |
| --- | --- | --- | --- |
| `src/assistant/AssistantSessionChooser.tsx` | Remove unused `React` import from a stub component | TS6133 on line 2; file returns `null` and does not reference `React` | High |
| `src/utils/toolPool.ts` | Remove or underscore-unused `mode` parameter in `mergeAndFilterTools` | TS6133 on line 58; parameter is documented but not read in function body | High |
| `src/services/tools/toolHooks.ts` | Remove unused `mcpServerBaseUrl` parameters in three call sites/functions | TS6133 at lines 48, 203, 443 | High |
| `src/components/PromptInput/IssueFlagBanner.tsx` | Remove unused imports (`React`, `FLAG_ICON`, and one fully unused import declaration) | TS6133 + TS6192 in one file | High |
| `src/components/Message.tsx` | Remove unused imports and dead import declarations | TS6133 on multiple imported names + TS6192 for one entire import declaration | High |
| `src/main.tsx` | Remove unused `React` import and two unused local timestamps | TS6133 on `React`, `mcpConfigResolvedMs`, `setupScreensStart` | High |
| `src/components/EffortPicker.tsx` | Trim unused hook import and unused effort helpers/types | TS6133/TS6196 cluster in one file | High |

## Broad cleanup patterns
These patterns account for most of the current noise.

### 1) Inline-props migration left orphaned `Props` aliases
Many UI files declare `type Props = ...` or similar aliases that are no longer referenced. The filtered pass shows repeated `TS6196` hits across `src/components/**`, `src/commands/**`, `src/context/**`, and `src/ink/**`.

**Likely cause:** component signatures were rewritten to inline destructured props while the old alias stayed behind.

**Examples:**
- `src/components/App.tsx`
- `src/components/ApproveApiKey.tsx`
- `src/components/AutoModeOptInDialog.tsx`
- `src/components/SearchBox.tsx`
- `src/context/mailbox.tsx`
- `src/ink/Ansi.tsx`

### 2) React hook imports no longer used after refactors
A large number of files import `useCallback`, `useMemo`, `useState`, or `React` and no longer reference them.

**Examples:**
- `src/components/ClaudeMdExternalIncludesDialog.tsx` (`useCallback`)
- `src/components/MCPServerDesktopImportDialog.tsx` (`useCallback`)
- `src/components/Markdown.tsx` (`useMemo`)
- `src/context/mailbox.tsx` (`useMemo`)
- `src/screens/Doctor.tsx` (`useCallback`, `useMemo`)

### 3) Local helper variables kept after logic changes
Several files still declare locals that are now dead after earlier behavior changes.

**Examples:**
- `src/components/Spinner.tsx` — `ttftText`
- `src/components/LogSelector.tsx` — multiple stale locals (`FUSE_THRESHOLD`, `isDeepSearchEnabled`, `searchableTextByLog`, etc.)
- `src/query.ts` — `jobClassifier`
- `src/screens/REPL.tsx` — `initialAgentName`, `initialAgentColor`, `newMessages`

## Intentional or likely-intentional “unused” items
These should **not** be mixed into a blind compiler-driven cleanup sweep.

| File | Why it should be treated separately | Confidence |
| --- | --- | --- |
| `src/ink/components/App.tsx` | `processKeysInBatch(app, items, _unused1, _unused2)` intentionally matches the `discreteUpdates(fn, a, b, c, d)` call shape | High |
| `src/tools/PowerShellTool/powershellSecurity.ts` | `_command` is documented as “unused, kept for API compat” | High |
| `src/types/plugin.ts` | comment explicitly says extra `PluginError` variants are unused today but intentionally reserved as roadmap types | High |
| `src/tools/AgentTool/forkSubagent.ts` | `getSystemPrompt` is explicitly documented as unused in the fork path; changing it belongs to API/design cleanup, not dead-import cleanup | High |
| `src/hooks/toolPermission/handlers/interactiveHandler.ts` | comment says one guard is “dead code today”, but it is feature/behavior gating rather than a trivial unused symbol | Medium |
| `src/components/tasks/RemoteSessionDetailDialog.tsx` | comment notes a fallback branch would be dead because `header` is required; needs behavior review before removal | Medium |
| `src/utils/computerUse/common.ts` | comment identifies a no-op/dead branch caused by CLI environment assumptions; treat as design cleanup, not import cleanup | Medium |

## Recommended cleanup order
1. **Low-risk compiler-only sweep in `src/components`**
   - remove unused `React` / hook imports
   - remove orphaned `Props` / alias types
   - remove obviously dead locals in files with isolated TS6133 hits
2. **Repeat the same sweep in `src/commands`, `src/hooks`, and `src/context`**
   - same pattern, still low risk
3. **Handle `src/utils` / `src/services` unused parameters separately**
   - parameters such as `mode` or `mcpServerBaseUrl` may be part of stable signatures, so review caller contracts first
4. **Review intentional compatibility placeholders last**
   - anything already commented as API-compat, feature-gated dead code, or roadmap type support should be deliberate, not mechanical

## Suggested ownership split for cleanup workers
- **Worker lane A:** `src/components/**` unused imports + props aliases
- **Worker lane B:** `src/commands/**`, `src/context/**`, `src/hooks/**` unused imports/types
- **Worker lane C:** `src/utils/**`, `src/services/**`, `src/tools/**` unused params/locals with API review
- **Separate review lane:** intentional/dead-branch comments and compatibility placeholders

## Verification notes
### PASS
- Report artifact created: `docs/unused-code-audit-2026-04-04.md`
- Concrete evidence gathered from filtered `tsc` unused-symbol pass plus manual file inspection

### LIMITATIONS
- A full repository `tsc --noEmit` run in this worktree is noisy for reasons unrelated to this task because dependencies/type environment are not installed in the worker checkout.
- No runtime tests were required for this analysis-only documentation task.
