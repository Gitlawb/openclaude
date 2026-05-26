# Plan: Auto-compact prompt on `/resume` + compaction progress bar

Status: **Planning** (not yet implemented)
Author: prep for future build
Scope: add a Claude-Code-style "compact this session?" prompt when resuming a
large conversation, and a determinate progress bar during compaction.

## Goal

1. When `/resume` loads a session that is large enough, prompt the user to
   compact it (threshold-gated, like Claude Code).
2. Show a real progress bar during compaction (manual `/compact` and the new
   resume-triggered path), replacing today's indeterminate text spinner.

## Decisions (locked)

- **Prompt trigger:** threshold-gated. Only prompt when the resumed
  conversation's token count is high; reuse `autoCompact` threshold logic. No
  nagging on small sessions.
- **Progress bar fill:** streamed-vs-estimate. Drive the ratio from live
  streamed output tokens against an estimated target; cap ~95% until done, snap
  to 100% on completion.
- **Feature flag:** new build-time `feature()` flag, default ON.

## Recon findings (current behavior)

### Resume flow
- `/resume` UI: `src/commands/resume/resume.tsx` → `handleSelect` → `onResume`
  → `context.resume?.(...)`.
- Real work: `resume` callback in `src/screens/REPL.tsx:1806`. Restores state
  and ends ~lines 2008–2019 (`setMessages(() => hydratedMessages)`,
  `setInputValue('')`, `logEvent('tengu_session_resumed', …)`). **No size check
  or compaction offer today.** This is the injection point.
- CLI-flag resume (`--resume-session`) and the ResumeConversation screen use a
  different path: `initialMessages` restored in a `useEffect` at
  `REPL.tsx:2061`. Both entrypoints must be covered, so prompt logic should be a
  shared helper called from both.

### Compaction infra (already present)
- `/compact`: `src/commands/compact/compact.ts` → `compactConversation` in
  `src/services/compact/compact.ts` (~1712 lines).
- Progress events: `CompactProgressEvent` in `src/Tool.ts:150` — only three
  coarse states (`hooks_start | compact_start | compact_end`). Consumed in
  `REPL.tsx:2577`, where they only drive `setSpinnerMessage('Compacting
  conversation')` — a text spinner, no bar, no percentage.
- During the summary, `compactConversation` calls `streamCompactSummary` and
  updates `setResponseLength`. `responseLengthRef` already feeds the spinner
  (`Spinner.tsx:210`, `leaderTokenCount = responseLengthRef.current / 4`). The
  live streamed-token count exists; only the denominator is missing.

### Reusable primitives
- `src/components/design-system/ProgressBar.tsx` — ratio `[0,1]` + width, block
  glyphs (`█ ▏▎…`). Drop-in.
- Token/threshold math: `src/services/compact/autoCompact.ts` —
  `getEffectiveContextWindowSize(model)`, `getAutoCompactThreshold(model)`,
  `calculateTokenWarningState(...)`. Gives the threshold gate.
- Interactive prompt pattern: `setToolJSX({ jsx, shouldHidePromptInput,
  isLocalJSXCommand })` + `onDone` callback (REPL.tsx:3360/3417). Dialog
  components live in `src/components/*Dialog.tsx`; option lists use
  `src/components/CustomSelect`.
- Non-interactive guard: `context.options.isNonInteractiveSession`.

## Implementation plan

### 1. Feature flag
- Add `RESUME_COMPACT_PROMPT: true` to `featureFlags` in `scripts/build.ts`
  (default ON). Guard all new entry points with `feature('RESUME_COMPACT_PROMPT')`
  so they dead-code-eliminate when off.

### 2. Threshold-gated prompt on resume
- New helper `src/services/compact/resumeCompactPrompt.ts`:
  - `shouldPromptCompactOnResume(messages, model): boolean` — count tokens for
    the resumed messages and compare against a fraction of
    `getAutoCompactThreshold(model)` (reuse `calculateTokenWarningState` so it
    matches the live warning). Returns false for empty/tiny sessions and when
    `isNonInteractiveSession`.
- New component `src/components/ResumeCompactPrompt.tsx` (mirrors existing
  `*Dialog.tsx` style): shows current vs context-window usage and a yes/no
  choice via `CustomSelect`. Default = Yes (matches Claude Code). `onDone(choice)`.
- Wire-in: after `setMessages(...)` in `REPL.tsx` `resume` (and from the
  `initialMessages` `useEffect` for CLI resume), if flag on and
  `shouldPromptCompactOnResume(...)`, present the component via `setToolJSX`. On
  **Yes**, invoke the existing `/compact` command path (reuse
  `compact/compact.ts call()`) so post-compact cleanup/cache-reset logic is
  shared. On **No**, dismiss and continue.

### 3. Determinate progress bar (streamed-vs-estimate)
- Extend `CompactProgressEvent` (`Tool.ts:150`) with a progress-tick variant,
  e.g. `{ type: 'compact_progress'; ratio: number }` (or carry
  streamed/estimated token counts).
- In `compactConversation`'s streaming loop (`src/services/compact/compact.ts`,
  near the `streamCompactSummary` calls at ~453/865 where `setResponseLength`
  updates), compute `ratio = min(0.95, streamedTokens / estimatedSummaryTokens)`
  and emit `compact_progress`. Estimate target from input size (capped fraction
  of pre-compact tokens, with floor/ceiling). Snap to `1.0` on `compact_end`.
- Also emit coarse ratios at phase transitions (hooks → start) so the bar moves
  immediately, not just once streaming begins.
- In `REPL.tsx:2577` `onCompactProgress`, store a `compactRatio` state and render
  `ProgressBar` (reuse the design-system component) with the existing "Compacting
  conversation" label. Keep the label; add the bar beneath it.
- Because both manual `/compact` and resume-triggered compaction go through
  `compactConversation`, the bar appears in both.

### 4. Tests
- `resumeCompactPrompt.test.ts`: threshold gating (tiny → no prompt; large →
  prompt; non-interactive → no prompt), using fixtures like `autoCompact.test.ts`.
- Compact service test: assert `compact_progress` events are emitted with
  monotonic, clamped ratios and a final `1.0`.
- ProgressBar already rendered elsewhere; smoke render only if convenient.

### 5. Validation before PR
- `bun run build`, `bun run smoke`.
- Focused: `bun test src/services/compact/` + new test files.
- Manual: build, `node dist/cli.mjs`, `/resume` a large session → confirm prompt;
  accept → progress bar fills; `/compact` directly → same bar.

## Files touched
- `scripts/build.ts` — feature flag
- `src/Tool.ts` — `CompactProgressEvent` extension
- `src/services/compact/compact.ts` — emit progress ticks
- `src/services/compact/resumeCompactPrompt.ts` — new (threshold helper)
- `src/components/ResumeCompactPrompt.tsx` — new (prompt UI)
- `src/screens/REPL.tsx` — wire prompt at resume + render `ProgressBar` in
  `onCompactProgress`
- tests as above

## Risks / notes
- **Post-React-Compiler output:** `resume.tsx` and many components are compiled
  output (the `_c(...)` memo scaffolding). Editing `REPL.tsx` by hand is fine,
  but write new components as plain JSX — the compiler runs at build; do not
  hand-write `_c` caches.
- **Estimate denominator is heuristic.** The bar is "feels-right," not exact;
  capping at 95% until completion avoids hitting 100% then stalling. Call this
  out in the PR description.
- **Two resume entrypoints** (callback vs `initialMessages` useEffect) must both
  be covered, or the prompt won't fire for `claude -r`.
- Reuse `/compact` `call()` rather than re-implementing compaction at the resume
  site, to keep cache-break/cleanup behavior consistent.
