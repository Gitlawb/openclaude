# OpenClaude — Bug & Issue Report

> Comprehensive audit of tools, skills, query engine, API layer, REPL, and core services.
> Generated: 2026-04-15 | Scope: `src/tools/*`, `src/skills/*`, `src/query.ts`, `src/services/*`, `src/screens/*`, `src/main.tsx`, `src/QueryEngine.ts`

---

## Table of Contents

- [Summary](#summary)
- [Critical (🔴)](#-critical)
- [Medium (🟡)](#-medium)
- [Low (🟢)](#-low)
- [Category Index](#category-index)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 12 |
| 🟡 Medium | 35 |
| 🟢 Low | 30 |
| **Total** | **77** |

**Most Dangerous Patterns:**

1. Silent error swallowing (`.catch(() => {})`) — ~15 instances across startup, MCP, notifications
2. Non-null assertions on feature-gated modules — `!` on `remoteSkillModules!`, `snipProjection!`, `contextCollapse!`
3. Infinite/deadlock risk — persistent retry loop clamp, continuation nudge without reset, sibling abort race
4. Data loss paths — dropped tool results on recovery, swallowed notification attachments, discarded concurrent tool context

---

## 🔴 Critical

### [#1] `src/tools/BashTool/bashSecurity.ts` — `isSafeHeredoc()` calls DEPRECATED function

**Lines:** ~510
**File:** `src/tools/BashTool/bashSecurity.ts`

`bashCommandIsSafe_DEPRECATED(remaining)` is called inside `isSafeHeredoc()` to re-validate the stripped remainder. This function is marked `@deprecated` and only used when tree-sitter is unavailable, but `isSafeHeredoc()` unconditionally calls the sync version — bypassing the more accurate tree-sitter async path. A command that tree-sitter would block could pass the regex-only DEPRECATED path.

---

### [#5] `src/tools/BashTool/bashPermissions.ts` — `getFirstWordPrefix()` generates overly broad rules

**Lines:** ~160-180
**File:** `src/tools/BashTool/bashPermissions.ts`

The regex `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` accepts single-word commands like `python3` or `node`. This means prefix rules like `Bash(python3:*)` can be generated, which auto-allow **any** python3 invocation — including `python3 -c "import os; os.system('rm -rf /')"`. This is extremely broad.

---

### [#6] `src/tools/BashTool/BashTool.tsx` — `splitCommand_DEPRECATED` used in 6+ places despite deprecation

**Lines:** 18, 267, 308, 323, 498
**File:** `src/tools/BashTool/BashTool.tsx`

The old `splitCommand_DEPRECATED` is called directly for mode validation, env var checks, and sandbox decisions. The new tree-sitter-based parser exists but isn't used here. Discrepancies between the two parsers could cause permission bypasses.

---

### [#12] `src/tools/AgentTool/AgentTool.tsx` — `agentIterator.return()` cleanup can abandon MCP connections

**Line:** 931
**File:** `src/tools/AgentTool/AgentTool.tsx`

When aborting an agent, `Promise.race` races `agentIterator.return()` with a 1-second timeout. If `return()` throws, the error is swallowed. If the timeout fires first, the agent's cleanup (MCP server disconnection, file state flushing) is abandoned. This could leave MCP connections dangling.

---

### [#24] `src/skills/loadSkillsDir.ts` — `Promise.all` in `findSkillMarkdownFiles` can exhaust file descriptors

**Lines:** ~401
**File:** `src/skills/loadSkillsDir.ts`

`Promise.all(childDirs.map(walk))` recursively walks directories in parallel. For deeply nested monorepos, this can open hundreds of concurrent file handles. No concurrency limit is applied.

---

### [#28] `src/tools/SkillTool/SkillTool.ts` — `remoteSkillModules!` non-null assertions gated by `feature()` only

**Lines:** 141, 391, 395, 506, 619, 673
**File:** `src/tools/SkillTool/SkillTool.ts`

`remoteSkillModules!` is used with non-null assertion, initialized at module scope with a `feature('EXPERIMENTAL_SKILL_SEARCH')` ternary. If the feature flag changes at runtime (GrowthBook hot-reload), `remoteSkillModules` could become null while the `!` assertion masks the error — a runtime crash with no stack trace pointing to the actual issue.

---

### [#33] `src/tools/FileReadTool/FileReadTool.ts` — `readImageWithTokenBudget` falls through to uncompressed image

**Lines:** ~1170
**File:** `src/tools/FileReadTool/FileReadTool.ts`

If both `compressImageBufferWithTokenLimit` and `sharp` fallback fail, the function returns the original uncompressed buffer. For a 50MB JPEG, this sends 50MB of base64 to the API, likely causing a token limit error or API rejection with no clear error message.

---

### [#37] `src/tools/shared/spawnMultiAgent.ts` — Team file TOCTOU race

**Lines:** ~540-570 (handleSpawnSplitPane), ~720-750 (handleSpawnSeparateWindow)
**File:** `src/tools/shared/spawnMultiAgent.ts`

`readTeamFileAsync` → modify → `writeTeamFileAsync` is a classic TOCTOU race. If two teammates spawn simultaneously, one's `members.push()` is lost. The team file format has no merge semantics.

---

### [#48] `src/query.ts` — `toolResults` dropped during max_output_tokens recovery

**Lines:** ~1130-1145
**File:** `src/query.ts`

In the `max_output_tokens_recovery` path, `state` is set with `[...messagesForQuery, ...assistantMessages, recoveryMessage]`. But `toolResults` from the current turn are NOT included — they're silently dropped. If tool results were yielded before the max_tokens error, the model gets a history missing its own tool outputs on retry.

---

### [#54] `src/services/api/withRetry.ts` — `attempt` clamp creates infinite loop in persistent mode

**Line:** ~513
**File:** `src/services/api/withRetry.ts`

`if (attempt >= maxRetries) attempt = maxRetries` — this keeps `attempt` at maxRetries forever. Combined with `persistentAttempt` growing, the retry loop never terminates via the `attempt > maxRetries` check. Only `options.signal?.aborted` can break it. If the abort signal is never fired (background agent), the loop runs forever burning API calls on 529s.

---

### [#58] `src/services/api/withRetry.ts` — `consecutive529Errors` counter persists across fallback

**Lines:** ~330-345
**File:** `src/services/api/withRetry.ts`

When `FallbackTriggeredError` is thrown, the `consecutive529Errors` count is NOT reset. If the fallback model ALSO hits 529s, the counter is already at 3+ and immediately triggers another fallback or error — even if the fallback model only had 1 real 529.

---

### [#62] `src/services/tools/StreamingToolExecutor.ts` — Race between `discard()` and `executeTool()`

**Lines:** ~251, ~145
**File:** `src/services/tools/StreamingToolExecutor.ts`

`discard()` sets `this.discarded = true` but doesn't prevent already-queued `executeTool` calls from starting. A tool that was `queued` when `discard()` was called could still start executing. The tool runs to completion, then `getCompletedResults` skips it because `this.discarded` is true — wasting execution.

---

### [#65] `src/screens/REPL.tsx` — Queue index access `[0]!` without length check

**Lines:** 1158, 4566, 4634, 4683, 4702, 4746
**File:** `src/screens/REPL.tsx`

Multiple `queue[0]!` accesses. If a race condition clears the queue between the render check and the access, this throws. The `!` assertion masks the null case.

---

## 🟡 Medium

### [#2] `src/tools/BashTool/bashSecurity.ts` — `extractQuotedContent()` desync with `inSingleQuote` toggle

**File:** `src/tools/BashTool/bashSecurity.ts`

In the quote tracker, when a `'` is encountered inside double quotes (`"`), the code checks `!inDoubleQuote` before toggling `inSingleQuote`. The `unquotedKeepQuoteChars` path adds the `'` even when `inDoubleQuote` is true. If this string is later used by `validateMidWordHash`, the extra `'` chars could create phantom adjacency to `#`.

---

### [#4] `src/tools/BashTool/bashPermissions.ts` — `stripSafeWrappers()` two-phase loop doesn't interleave

**File:** `src/tools/BashTool/bashPermissions.ts`

Phase 1 strips env vars + comments, Phase 2 strips wrappers + comments. They don't alternate. A pattern like `nice FOO=bar timeout 5 rm -rf /` would: Phase 1 strips nothing (FOO not in SAFE_ENV_VARS); Phase 2 strips `nice ` then `timeout 5 ` → leaves `FOO=bar rm -rf /`.

---

### [#7] `src/tools/BashTool/pathValidation.ts` — Symlink race condition (TOCTOU)

**File:** `src/tools/BashTool/pathValidation.ts`

Path validation checks if a path resolves under `cwd` using `realpath()`, then the command executes. Between the check and execution, a symlink target could be swapped (symlink attack). The codebase acknowledges this with comments but doesn't use `O_NOFOLLOW` or `openat()`-based approaches.

---

### [#8] `src/tools/FileEditTool/FileEditTool.ts` — `MAX_EDIT_FILE_SIZE = 1 GiB` allows OOM

**File:** `src/tools/FileEditTool/FileEditTool.ts`

The 1 GiB limit is checked via `fs.stat()` before reading. But the actual edit operation reads the file into a string, which doubles memory (original + new content in V8). A 1 GiB file could cause 2+ GiB memory spike. No streaming/chunked edit path exists.

---

### [#10] `src/tools/FileWriteTool/FileWriteTool.ts` — `addSkillDirectories().catch(() => {})` swallows errors

**Lines:** 241 (FileWriteTool), 418 (FileEditTool), 586 (FileReadTool)
**Files:** `src/tools/FileWriteTool/FileWriteTool.ts`, `src/tools/FileEditTool/FileEditTool.ts`, `src/tools/FileReadTool/FileReadTool.ts`

After writing/editing/reading a file, skill directories are discovered and loaded. Errors are silently caught with `() => {}`. If the skill directory contains a malformed SKILL.md, the user gets no indication.

---

### [#11] `src/tools/AgentTool/runAgent.ts` — `resolveAgentProvider()` override not documented

**Lines:** ~352-354
**File:** `src/tools/AgentTool/runAgent.ts`

`resolveAgentProvider()` can override the model resolved by `getAgentModel()`. If the provider override returns a different model than expected, the agent silently uses a different model without notifying the user. The `effectiveModel` is used for API calls but not surfaced in agent metadata.

---

### [#13] `src/tools/AgentTool/loadAgentsDir.ts` — Memoized `getSkillDirCommands` cache never expires

**File:** `src/skills/loadSkillsDir.ts` (line 723)

The `getSkillDirCommands` function is memoized with `lodash-es/memoize`. The cache key is the `cwd` string. If the user adds/removes skills during a session without calling `clearSkillCaches()`, stale skills persist. Dynamic discovery calls `skillsLoaded.emit()` but doesn't clear `getSkillDirCommands` cache in all code paths.

---

### [#15] `src/tools/WebFetchTool/WebFetchTool.ts` — Firecrawl path skips redirect handling

**File:** `src/tools/WebFetchTool/WebFetchTool.ts`

When `FIRECRAWL_API_KEY` is set, the tool uses `scrapeWithFirecrawl()` which returns `{ markdown, bytes }` directly — bypassing the redirect detection, preapproved URL check, and content type validation that the normal path provides.

---

### [#16] `src/tools/WebFetchTool/WebFetchTool.ts` — `process.env.FIRECRAWL_API_KEY!` non-null assertion

**Line:** ~30
**File:** `src/tools/WebFetchTool/WebFetchTool.ts`

`new FirecrawlClient({ apiKey: process.env.FIRECRAWL_API_KEY! })` — the `!` assertion is unsafe. If the env var is removed between the `isFirecrawlEnabled()` check and this line, this throws at runtime.

---

### [#20] `src/tools/WebSearchTool/providers/custom.ts` — IPv6 parsing incomplete

**Lines:** 250-261
**File:** `src/tools/WebSearchTool/providers/custom.ts`

IPv6 private range detection covers `::a.b.c.d` (deprecated) and `fec0::/10` (site-local) but misses `::ffff:0:0/96` (IPv4-mapped) and doesn't check `fc00::/7` (unique local). A custom search provider on `::ffff:192.168.1.1` would be treated as a public IP.

---

### [#22] `src/skills/loadSkillsDir.ts` — `getSkillDirCommands` memoization with cwd key only

**File:** `src/skills/loadSkillsDir.ts`

The memoized function caches by `cwd` string. If the user `cd`s to a different directory within the same session, the old cache is used. Only `clearSkillCaches()` invalidates it, which is not called on directory change in all paths.

---

### [#23] `src/skills/loadSkillsDir.ts` — `conditionalSkills` map grows unbounded

**File:** `src/skills/loadSkillsDir.ts`

Skills with `paths` frontmatter are stored in a `conditionalSkills` Map. Once activated, they move to `dynamicSkills`. But if a conditional skill's path pattern never matches any file, it stays in the Map for the entire session. For large projects with many conditional skills, this is a slow memory leak.

---

### [#25] `src/skills/loadSkillsDir.ts` — `executeShellCommandsInPrompt` runs with skill's `allowedTools` as session rules

**Line:** ~400
**File:** `src/skills/loadSkillsDir.ts`

When building the skill prompt, `alwaysAllowRules.command` is set to `allowedTools`. This means inline shell commands (`!``...``) in SKILL.md run with the skill's allowed-tools list as permission rules — but the session-level rules from the parent are also present.

---

### [#29] `src/tools/SkillTool/SkillTool.ts` — `command` null dereference risk in inline path

**Lines:** ~530, ~560
**File:** `src/tools/SkillTool/SkillTool.ts`

After `findCommand()`, the code accesses `command?.type === 'prompt'` (optional chain) but later accesses `command.source` without optional chaining. If `findCommand` returns undefined (race between validateInput and call), this throws.

---

### [#30] `src/tools/SkillTool/SkillTool.ts` — `SAFE_SKILL_PROPERTIES` doesn't include `hooks`

**File:** `src/tools/SkillTool/SkillTool.ts`

The `skillHasOnlySafeProperties` function checks if a skill has only safe properties before auto-allowing. The `hooks` property is in the safe list, but `allowedTools` is NOT — meaning any skill with `allowed-tools` frontmatter goes through permission prompts even if it only uses safe tools.

---

### [#31] `src/tools/SkillTool/SkillTool.ts` — `executeForkedSkill` doesn't propagate errors cleanly from `runAgent`

**File:** `src/tools/SkillTool/SkillTool.ts`

If `runAgent` throws (e.g., API error, model unavailable), the error is caught by the outer try/catch but the `finally` block still calls `clearInvokedSkillsForAgent(agentId)`. The `agentMessages` array may contain partial data that leaks into the result text.

---

### [#32] `src/tools/FileReadTool/FileReadTool.ts` — `fileReadListeners` array unbounded growth

**File:** `src/tools/FileReadTool/FileReadTool.ts`

`registerFileReadListener` adds callbacks to a module-scoped array. There's no cleanup on session end, only manual unsubscribe. If a listener registers but the unsubscribe function is never called, listeners accumulate.

---

### [#34] `src/tools/FileReadTool/FileReadTool.ts` — `callInner` doesn't handle symlink loops

**File:** `src/tools/FileReadTool/FileReadTool.ts`

`readFileInRange` and `fs.stat` follow symlinks by default. A symlink loop (`a -> b -> a`) would cause ELOOP, but the error handler only checks for ENOENT. ELOOP falls through as an unhandled error.

---

### [#35] `src/tools/FileReadTool/FileReadTool.ts` — Dedup logic uses `Math.floor(stats.mtimeMs)` but precision varies

**File:** `src/tools/FileReadTool/FileReadTool.ts`

On HFS+ (macOS), mtime has 1-second precision. On ext4, it's nanosecond. A file edited within the same second could have identical `Math.floor(mtimeMs)` values, causing the dedup to return `file_unchanged` when the content actually changed.

---

### [#36] `src/tools/shared/spawnMultiAgent.ts` — ~80% code duplication between split-pane and separate-window handlers

**File:** `src/tools/shared/spawnMultiAgent.ts`

`handleSpawnSplitPane` and `handleSpawnSeparateWindow` share ~80% duplicated code. A bug fix in one path must be manually replicated to the other. The `inheritedFlags` model-override stripping logic is copy-pasted verbatim.

---

### [#38] `src/tools/shared/spawnMultiAgent.ts` — `buildInheritedCliFlags` model name quoting issue

**File:** `src/tools/shared/spawnMultiAgent.ts`

`quote([modelOverride])` handles the model name, but `--model` is joined with space, not with the value. If `inheritedFlags` is later concatenated into a shell command, the `--model value` pair could be split.

---

### [#40] `src/skills/bundledSkills.ts` — `extractBundledSkillFiles` memoizes failure permanently

**Line:** ~66
**File:** `src/skills/bundledSkills.ts`

`extractionPromise ??= extractBundledSkillFiles(...)` — if the first extraction fails (returns null), subsequent calls reuse the same resolved promise (null) and never retry. A transient filesystem error permanently disables the skill's reference files.

---

### [#41] `src/skills/bundledSkills.ts` — `resolveSkillFilePath` traversal check edge cases

**File:** `src/skills/bundledSkills.ts`

`normalized.split(pathSep).includes('..')` — behavior of `normalize()` on unusual inputs like `foo/.\\..\\/bar` varies by Node version. Edge cases could bypass the traversal check.

---

### [#42] `src/tools/WebFetchTool/WebFetchTool.ts` — Redirect response doesn't validate `redirectUrl`

**File:** `src/tools/WebFetchTool/WebFetchTool.ts`

The redirect handler constructs a message with `response.redirectUrl` directly interpolated. If the redirect URL contains shell metacharacters or newlines, it could confuse downstream parsing.

---

### [#46] `src/tools/TaskOutputTool/TaskOutputTool.tsx` — `startPolling`/`stopPolling` reference counting issue

**File:** `src/tools/TaskOutputTool/TaskOutputTool.tsx`

Multiple callers can call `startPolling` for the same task ID. If `stopPolling` is called before all readers are done, the poller stops and remaining readers get stale data.

---

### [#49] `src/query.ts` — `continuationNudgeCount` resets on `next_turn` but NOT on `stop_hook_blocking`

**File:** `src/query.ts`

On `stop_hook_blocking`, `continuationNudgeCount` is preserved. On `next_turn`, it's reset to 0. A stop-hook blocking error can cause infinite continuation nudges across turns (counter never resets). Each nudge burns one API call.

---

### [#52] `src/query.ts` — `pendingToolUseSummary` promise rejection terminates query loop

**Line:** ~1090
**File:** `src/query.ts`

`const summary = await pendingToolUseSummary` — if the promise rejects (Haiku API error), the error propagates up and terminates the query loop. The `.catch(() => null)` on `nextPendingToolUseSummary` handles the NEXT turn's summary, but the current turn's pending summary can still throw.

---

### [#55] `src/services/api/withRetry.ts` — `is529Error` message-based check is fragile

**File:** `src/services/api/withRetry.ts`

`error.message?.includes('"type":"overloaded_error"')` — this string check depends on the API's error serialization format. If the API changes from JSON-within-string to a structured error object, this silently stops matching.

---

### [#59] `src/services/tools/StreamingToolExecutor.ts` — `contextModifiers` not applied for concurrent tools

**Line:** ~490
**File:** `src/services/tools/StreamingToolExecutor.ts`

Concurrent tools' context modifiers are silently dropped. The comment says "None are actively being used," but if a concurrent tool EVER adds a context modifier, it would be silently ignored.

---

### [#60] `src/services/tools/StreamingToolExecutor.ts` — `siblingAbortController` abort reason lost on multiple errors

**File:** `src/services/tools/StreamingToolExecutor.ts`

When two concurrent Bash tools error simultaneously, `abort('sibling_error')` is called twice. The second call's reason is ignored. The `erroredToolDescription` reflects the first error, but the second error's description is lost.

---

### [#63] `src/screens/REPL.tsx` — `setInterval` for title animation never cleared on unmount

**Line:** ~506
**File:** `src/screens/REPL.tsx`

`setInterval(_temp2, TITLE_ANIMATION_INTERVAL_MS, setFrame)` — if the component unmounts before `clearInterval` is called, the interval continues firing on a stale `setFrame` reference.

---

### [#64] `src/screens/REPL.tsx` — `.catch(() => [])` on notification attachments swallows errors

**Line:** ~2577
**File:** `src/screens/REPL.tsx`

`getQueuedCommandAttachments(removedNotifications).catch(() => [])` — if attachment generation fails, the error is silently swallowed. The notification is consumed from the queue but its content is lost.

---

### [#67] `src/main.tsx` — `commandsPromise?.catch(() => {})` silently swallows init errors

**Lines:** 1926-1927
**File:** `src/main.tsx`

If command or agent definition loading fails during startup, the error is silently caught. The session starts with missing commands/agents with no indication.

---

### [#68] `src/main.tsx` — `mcpPromise.catch(() => {})` hides MCP connection failures

**Line:** 2442
**File:** `src/main.tsx`

MCP server connections that fail during startup are silently caught. Tools from those servers are unavailable with no error message.

---

### [#72] `src/QueryEngine.ts` — `snipProjection!` non-null assertion

**Line:** 1293
**File:** `src/QueryEngine.ts`

`snipProjection!` — if the snip module loaded but `snipProjection` wasn't initialized, this throws.

---

### [#74] `src/services/mcp/client.ts` — MCP connections not cleaned up on session abort

**File:** `src/services/mcp/client.ts`

MCP clients are connected during startup and tracked in `appState.mcp.clients`. When the session is aborted or ends, there's no guaranteed cleanup path.

---

### [#76] `src/services/api/errors.ts` — `isPromptTooLongMessage` string matching is fragile

**File:** `src/services/api/errors.ts`

Matches error messages by substring. If the API changes wording, prompt-too-long detection silently breaks, and oversized contexts go straight to the API producing 500s.

---

## 🟢 Low

### [#3] `src/tools/BashTool/bashPermissions.ts` — `MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50` cap returns generic `ask`

**File:** `src/tools/BashTool/bashPermissions.ts`

When a compound command exceeds 50 subcommands, the system falls back to `behavior: 'ask'`. The user sees a generic permission prompt with no explanation that the command was too complex to validate.

---

### [#9] `src/tools/FileEditTool/FileEditTool.ts` — `old_string === new_string` check only catches exact match

**File:** `src/tools/FileEditTool/FileEditTool.ts`

If `old_string` and `new_string` differ only in trailing whitespace or unicode normalization, the edit silently makes no visible change but still triggers file writes and git diff checks.

---

### [#14] `src/tools/AgentTool/agentToolUtils.ts` — `allowedTools` replaces ALL session rules

**File:** `src/tools/AgentTool/agentToolUtils.ts`

When `allowedTools` is provided to `runAgent`, it replaces `session` rules entirely. If the parent had session-level approvals for other tools, the subagent loses them.

---

### [#17] `src/tools/WebFetchTool/utils.ts` — `getSettings_DEPRECATED()` used for fetch config

**Line:** 392
**File:** `src/tools/WebFetchTool/utils.ts`

Uses deprecated settings API. If the settings migration removes this function, WebFetch breaks silently.

---

### [#18] `src/tools/WebSearchTool/providers/firecrawl.ts` — No AbortSignal support

**Line:** 14
**File:** `src/tools/WebSearchTool/providers/firecrawl.ts`

`@mendable/firecrawl-js` SDK doesn't accept AbortSignal. In-flight searches can't be cancelled when the user interrupts.

---

### [#19] `src/tools/WebSearchTool/providers/duckduckgo.ts` — No AbortSignal support

**Line:** 22
**File:** `src/tools/WebSearchTool/providers/duckduckgo.ts`

`duck-duck-scrape` doesn't accept AbortSignal either.

---

### [#21] `src/tools/PowerShellTool/PowerShellTool.tsx` — `setTimeout` argument-passing pattern is fragile

**Line:** 879
**File:** `src/tools/PowerShellTool/PowerShellTool.tsx`

`setTimeout(r => r(null), timeUntilNextProgress, resolve)` relies on Node.js passing extra `setTimeout` args to the callback. Non-obvious and could break if refactored to use a different runtime.

---

### [#26] `src/skills/bundled/index.ts` — Bundled skills registration order is undefined

**File:** `src/skills/bundled/index.ts`

If two bundled skills define the same name, the last one loaded wins. No warning or error is emitted. Could cause silent skill shadowing.

---

### [#27] `src/tools/MCPTool/MCPTool.ts` — MCP tool calls don't validate output schemas

**File:** `src/tools/MCPTool/MCPTool.ts`

MCP server tool results are passed through without schema validation against the declared output schema. A malicious MCP server could return unexpected data shapes.

---

### [#39] `src/tools/shared/spawnMultiAgent.ts` — `abortController` signal listener leak

**File:** `src/tools/shared/spawnMultiAgent.ts`

`registerOutOfProcessTeammateTask` adds an `abort` event listener with `{ once: true }`. But if the task completes normally, the abort signal is never fired, and the listener is never removed.

---

### [#43] `src/tools/WebFetchTool/utils.ts` — Fetch timeout from deprecated settings

**Line:** 392
**File:** `src/tools/WebFetchTool/utils.ts`

Fetch timeout is read from deprecated settings. If the function is removed, the timeout defaults to whatever the fetch implementation uses.

---

### [#44] `src/tools/MonitorTool/MonitorTool.ts` — No cleanup for background monitoring

**File:** `src/tools/MonitorTool/MonitorTool.ts`

The tool starts a monitoring process but cleanup relies on the task lifecycle. If the tool call is interrupted without proper abort signal propagation, the monitoring process continues running.

---

### [#45] `src/tools/ScheduleCronTool/CronCreateTool.ts` — No validation of cron expression edge cases

**File:** `src/tools/ScheduleCronTool/CronCreateTool.ts`

Accepts cron expressions but doesn't validate for pathological patterns like `* * * * *` (every minute). No rate limiting on the number of cron jobs a session can create.

---

### [#47] `src/tools/ConfigTool/ConfigTool.ts` — No input sanitization for setting values

**File:** `src/tools/ConfigTool/ConfigTool.ts`

Accepts arbitrary string values for settings. While the settings schema validates types, string values aren't sanitized for length or content.

---

### [#50] `src/query.ts` — `taskBudgetRemaining` compaction math edge case

**File:** `src/query.ts`

After the first compact, `taskBudgetRemaining` is set from `total - preCompactContext`. Each subsequent compact subtracts `preCompactContext` independently. Tokens consumed between compacts may be under-counted.

---

### [#51] `src/query.ts` — Streaming fallback tombstones may confuse SDK consumers

**Lines:** ~485
**File:** `src/query.ts`

When `streamingFallbackOccured` fires, tombstones are yielded for `assistantMessages`. Some messages may have ALREADY been yielded. SDK consumers that process messages in order would see a message, then its tombstone.

---

### [#53] `src/query.ts` — `yieldMissingToolResultBlocks` doesn't consistently set `is_error`

**File:** `src/query.ts`

Used in fallback recovery and abort paths. Some tool implementations check `is_error: true` to decide cleanup behavior. If the generic message doesn't set `is_error`, cleanup may be skipped.

---

### [#56] `src/services/api/withRetry.ts` — `getRetryAfterMs` doesn't handle HTTP-date format

**File:** `src/services/api/withRetry.ts`

`parseInt(retryAfter, 10)` — the HTTP spec allows retry-after as an HTTP-date. `parseInt` returns `NaN` for date values, falling through to `null`. Silent failure to honor the server's directive.

---

### [#57] `src/services/api/withRetry.ts` — `parseOpenAIDuration` regex allows empty match

**File:** `src/services/api/withRetry.ts`

All regex groups are optional. An empty string `""` passes the regex. The `total > 0` check catches this, but inconsistent handling of edge cases.

---

### [#61] `src/services/tools/StreamingToolExecutor.ts` — `progressAvailableResolve` can leak

**Line:** ~476
**File:** `src/services/tools/StreamingToolExecutor.ts`

If no progress arrives and no tools complete, this resolver is never called. The `Promise.race` would wait forever if both promises are pending.

---

### [#66] `src/screens/REPL.tsx` — `editorTimerRef` timeout leak

**Line:** ~716
**File:** `src/screens/REPL.tsx`

If the editor closes before the timeout fires, the timeout runs on a stale reference. No cleanup in useEffect.

---

### [#69] `src/main.tsx` — `(global as any).require('inspector')` type escape

**Line:** 257
**File:** `src/main.tsx`

`as any` cast to access Node.js inspector. If the runtime isn't Node.js (e.g., Bun), `require` may not exist. No try/catch.

---

### [#70] `src/main.tsx` — `rawCliArgs[pmIdx + 1]!` unsafe index access

**Line:** 727
**File:** `src/main.tsx`

Accesses `rawCliArgs[pmIdx + 1]` with `!` after checking `pmIdx !== -1`. But doesn't check if `pmIdx + 1` is within bounds. If `--permission-mode` is the last argument, this is `undefined`.

---

### [#71] `src/main.tsx` — `sessionStartHooksPromise?.catch(() => {})` fire-and-forget

**Line:** 2600
**File:** `src/main.tsx`

Session start hooks that throw are silently caught. If a hook initializes critical state, the session starts incomplete.

---

### [#73] `src/QueryEngine.ts` — `snipCompactIfNeeded` operates on potentially stale store

**Line:** 1295
**File:** `src/QueryEngine.ts`

`snipModule!.snipCompactIfNeeded(store, { force: true })` — if the store was modified between the snip boundary check and this call (async gap), the force-compact operates on stale data.

---

### [#75] `src/services/tools/toolExecution.ts` — No global timeout on tool execution

**File:** `src/services/tools/toolExecution.ts`

Tools like `BashTool` have their own timeout handling, but the orchestration layer has no global timeout. A tool that hangs blocks the streaming executor indefinitely.

---

### [#77] `src/services/api/errorUtils.ts` — `maxDepth = 5` may truncate real error chains

**File:** `src/services/api/errorUtils.ts`

Error object property traversal is capped at depth 5. Deeply nested error objects may have their root cause truncated.

---

## Category Index

### BashTool (Security)
#1, #2, #4, #5, #6, #7

### File Tools (Read/Write/Edit)
#8, #9, #10, #32, #33, #34, #35

### Agent & Skill Tools
#11, #12, #13, #28, #29, #30, #31

### Skill System (Loading/Bundled)
#22, #23, #24, #25, #26, #40, #41

### Web Tools (Fetch/Search)
#15, #16, #17, #18, #19, #20, #42, #43

### Spawn / Team / Multi-Agent
#36, #37, #38, #39

### Query Engine & Request Loop
#48, #49, #50, #51, #52, #53, #72, #73

### API / Retry / Error Handling
#54, #55, #56, #57, #58, #76, #77

### Streaming Tool Executor
#59, #60, #61, #62

### REPL / Screens
#63, #64, #65, #66

### Main Entry / Startup
#67, #68, #69, #70, #71

### MCP
#27, #74

### Task / Config / Monitor Tools
#3, #44, #45, #46, #47, #75
