/**
 * Flags that mark the invocation as prompt-mode: a following `skills` is the
 * user's PROMPT TEXT, not the management subcommand. The leading scan stops
 * routing when it sees one.
 *
 * Kept beside the boolean set on purpose — the two must stay disjoint, the
 * boolean set is tested first, and an entry appearing in both silently wins
 * there. `skillsBooleanFlags.test.ts` asserts the disjointness.
 */
export const SKILLS_PROMPT_MODE_FLAGS: ReadonlySet<string> = new Set([
  '--continue',
  '--from-pr',
  '--print',
  '-c',
  '-p',
  '-r',
  '--resume',
])

/**
 * Global boolean (value-less) flags that may sit around a `skills` subcommand.
 *
 * Two pre-parsers need this set: the leading-flag scan in
 * `src/entrypoints/cli.tsx` (which decides whether argv routes to the skills
 * handler) and the trailing-flag scan in `src/cli/handlers/skillsCli.ts`. They
 * held verbatim copies, so adding one flag meant editing both — and a miss
 * surfaces at runtime as `Unknown skills option: --x`, never as a type error.
 *
 * The contract is value-less AND ROUTING-NEUTRAL — both halves matter, and only
 * the first is obvious. Entries are skipped without consuming a following token,
 * so a value-taking option leaves its value behind as a stray operand; but a
 * value-less option that CHANGES WHAT THE INVOCATION MEANS must not be here
 * either. Those belong in SKILLS_PROMPT_MODE_FLAGS below.
 *
 * That distinction is not theoretical: `--continue` is value-less, so an
 * enumeration of commander's value-less options says it belongs here — and
 * adding it broke `openclaude --continue skills list`, which must resume the
 * prior conversation with `skills list` as its PROMPT. The leading scan tests
 * this set first, so an entry here silently overrides prompt-mode handling.
 *
 * `--debug` is a deliberate exception, inherited from both original copies: its
 * value is optional (`-d, --debug [filter]`), and the alternative is worse. If
 * this pre-parse consumed the next token, `openclaude skills --debug list`
 * would swallow the SUBCOMMAND as the filter and stop routing to `list` — the
 * pre-parse cannot tell a filter from a subcommand, because it does not know
 * the subcommand set. The cost is that an explicitly supplied filter leaks:
 * `skills show --debug api` binds `api` as the skill name. Pre-existing on both
 * copies; noted here rather than silently traded away.
 *
 * Kept in its own module rather than exported from either consumer: `cli.tsx` is
 * the entrypoint (top-level side effects, latency-sensitive) and importing it
 * from a handler would be a cycle, while importing the handler from `cli.tsx`
 * would pull it into startup.
 */
export const SKILLS_GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  '--bare',
  '--debug',
  '--debug-to-stderr',
  '--yolo', // alias for --dangerously-skip-permissions
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--deep-link-origin',
  '--plan-mode-required',
  '--tmux',
  // Feature-gated in scripts/build.ts, so absent from the default build's argv —
  // listed anyway because a flag that is not registered simply never appears,
  // whereas a missing entry is a runtime `Unknown skills option` the day the
  // flag ships enabled.
  '--assistant',
  '--brief',
  '--enable-auto-mode',
  '--hard-fail',
  '--proactive',
  '--disable-slash-commands',
  '--enable-auth-status',
  '--fork-session',
  '--ide',
  '--include-hook-events',
  '--include-partial-messages',
  '--init',
  '--init-only',
  '--maintenance',
  '--mcp-debug',
  '--chrome',
  '--no-chrome',
  '--no-session-persistence',
  '--replay-user-messages',
  '--strict-mcp-config',
  '--verbose',
])
