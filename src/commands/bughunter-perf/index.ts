import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { createGetAppStateWithAllowedTools } from '../../utils/forkedAgent.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../utils/markdownConfigLoader.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'
import { MalformedCommandError, ShellError } from '../../utils/errors.js'
import { createMovedToPluginCommand } from '../createMovedToPluginCommand.js'

const BUGHUNTER_PERF_PROMPT = `---
allowed-tools: Read, Glob, Grep, LS, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)
description: Performance-focused bug hunt — hot-path complexity, sync I/O, leaks, N+1
---

You are a performance engineer running a focused performance audit on a real
codebase. This is a sibling of \`/bughunter\`, narrowed to performance and
resource issues. It is **not** a general code review.

SCOPE: {{ARGS}}

GIT CONTEXT (auto-collected, may be empty if not a git repo):

\`\`\`
!\`git status 2>/dev/null\`
\`\`\`
(If empty: not a git repository or git unavailable)

UNSTAGED CHANGES (working tree):

\`\`\`
!\`git diff --name-only --diff-filter=AM 2>/dev/null\`
\`\`\`
(If empty: no unstaged changes or not a git repo)

STAGED CHANGES (index):

\`\`\`
!\`git diff --cached --name-only --diff-filter=AM 2>/dev/null\`
\`\`\`
(If empty: no staged changes or not a git repo)

RECENTLY COMMITTED FILES (last 10 commits):

\`\`\`
!\`git log -10 --pretty=format: --name-only --diff-filter=AM 2>/dev/null\`
\`\`\`
(If empty: no git history or not a git repo)

DIFF OF UNSTAGED + STAGED CHANGES (first 400 lines):

\`\`\`
!\`git diff HEAD -- . 2>/dev/null\`
\`\`\`
(If empty: no diff available or not a git repo)

---

## Phase 1 — Map the Hot Paths

Use Glob and Grep to identify the 5–7 most critical files for the scope above.
If no scope was given, focus on staged + unstaged + recent-commit buckets.
**If git context is empty, use Glob/Grep to find performance-critical files:**
- Request handlers / RPC entry points / API routes (per-request cost matters)
- Tight loops, hot-path utility functions, render pipelines
- Data access layers (DB / cache / filesystem / network) on the request path
- Event listeners, subscriptions, timers, intervals
- Resource acquisition (connections, file handles, child processes)
- Serialization / deserialization hot paths (JSON, encoding, parsing)
- Build/bundle entry points (webpack config, vite config, etc.)

Read the surrounding code, not just the diff. Bugs hide in context.

## Phase 2 — Hunt (Performance Categories)

**A — Algorithmic complexity**
- O(n²) or worse in a tight loop, sort, or comparison chain that runs per request
- Nested loops over the same collection when a single pass + map would do
- Repeated linear scans where an index / hash would be O(1)
- Inefficient sort where a stable linear-time alternative exists for the data shape
- Recomputing the same value per iteration when it could be hoisted

**B — Concurrency / async**
- Sequential \`await\`s that could be \`Promise.all\` (independent I/O in series)
- Missing \`await\` on a promise that must complete before the next step
- Fire-and-forget promise that swallows errors
- \`forEach\` with async callbacks (does not await — almost always a bug)
- Blocking call (\`readFileSync\`, \`JSON.parse\` of a huge blob) on a request path
- Synchronous CPU work in an async function that stalls the event loop

**C — Data access**
- **N+1 query**: loop performing one query / fetch per item
- Missing pagination (loads full collection into memory)
- Missing index (query on unindexed column in a hot table)
- Cache miss where the same value is recomputed per request
- Cache stampede / unbounded cache growth

**D — Memory & resources**
- Unbounded array / map / set growth (no eviction, no cap)
- Listener / timer / interval leak (\`addEventListener\` / \`setInterval\` without cleanup)
- Stream or connection leak (opened but never closed / released)
- String concatenation in a loop building a huge final string
- Accidental retention via closure holding large objects
- Large object held in module scope for the process lifetime

**E — Hot-path I/O**
- Filesystem read / write on every request where a cached or in-memory value works
- Network call per iteration that could be batched
- Repeated DNS resolution in a loop
- Logging that builds a serialized payload on every request (even at info level)

**F — String & regex**
- Regex compiled inside a hot loop (move out of the loop body)
- Catastrophic backtracking risk (nested quantifiers like \`(a+)+\` on untrusted input)
- Large string \`slice\` / \`substring\` per iteration that allocates repeatedly
- JSON.parse / JSON.stringify of a deep object on every request

**G — Rendering / UI (if applicable)**
- Re-rendering the entire tree on a state change that affects one node
- Synchronous layout thrash (read DOM size, mutate, read again, mutate)
- Heavy work on the main thread where a worker would isolate it
- Inefficient list rendering (missing keys, no virtualization for long lists)

**H — Build / bundle**
- Large dependency imported into a hot path when a small alternative exists
- Side-effectful top-level import that runs expensive code on module load

## Phase 3 — Skeptic Pass

For each candidate, answer ALL three:

1. **Hot path?** Is this on a per-request / per-frame / per-message code path,
   or is it a one-shot startup / build / migration cost? One-shot costs are
   out of scope unless they prevent the app from starting.
2. **Realistic input size?** Will this trigger with realistic data, or does it
   require a synthetic worst case? Note the input size at which it bites.
3. **Measurable impact?** Estimate order-of-magnitude (constant, linear, super-linear)
   and the dominant cost (CPU / I/O / memory / GC).

**Drop all candidates where the dominant cost is not measurable at realistic load.**

## Phase 4 — Fix Proposals

For every surviving finding, write a **concrete patch sketch** with the actual
function signature, variable names, and import style. Show the before/after
in 3–8 lines. If the fix is structural (architectural change, requires new
infrastructure), say so and list what the user needs to decide.

---

## Hard Exclusions — Automatically Skip

Do not report findings in any of these categories:

1. **DoS / resource exhaustion as a security issue** — handled by \`/bughunter-security\`
2. **Micro-optimizations** with no measurable impact on real workloads
3. **One-time startup / migration costs** (cold start, first-run setup, schema seed)
4. **Theoretical complexity** without a concrete path that runs at realistic input size
5. **Build / test / CI performance** — out of scope for production code paths
6. **Memory safety issues** in memory-safe languages (Rust, etc.) — not perf bugs
7. **Logging performance** unless it is the dominant cost on a hot path
8. **Documentation files** (*.md) — not code
9. **Test files** — not production
10. **Style, naming, formatting** — never report
11. **Add TypeScript types to JS files** (or vice versa)
12. **Missing JSDoc / inline comments**
13. **"Could be faster in 5 years" speculative maintenance concerns**
14. **Outdated third-party libraries** — managed separately
15. **Concurrency primitives that are "technically" suboptimal but yield no
    measurable difference at the actual input sizes the code sees**
16. **Performance of an unmaintained code path** (deprecated, scheduled for removal)
17. **Cache hits that "could be better"** without evidence of cache miss being a bottleneck
18. **Network latency** that the application cannot influence (3rd party API)

## Output Format

**Step 1 — Summary line:**
\`Total confirmed perf issues: N | Critical: C | Medium: M\`

Where:
- Critical = function will not return in reasonable time / OOM at realistic input
- Medium = noticeable latency (>100ms) or excessive allocation at realistic input

**Step 2 — Findings table:**

| # | File:Line | Severity | Hot path | Category | Bottleneck | Fix sketch |
|---|-----------|----------|----------|----------|------------|------------|
| 1 | src/foo.ts:42 | Critical | request handler | N+1 | DB call per loop iter | \`const items = await db.query('SELECT * FROM t WHERE id = ANY($1)', [ids])\` |
| 2 | src/bar.ts:17 | Medium | render loop | regex | /foo/g compiled per iter | \`const RE = /foo/g; while ((m = RE.exec(s)) !== null) ...\` |

The Hot path column must name the specific code path. The Bottleneck column
must state the dominant cost. The Fix sketch column must be **code**, not prose.

**Step 3 — Required follow-up:**

> "Found N performance issues (C critical, M medium). Want to open a fix spec for the critical ones?"

If no issues, say so and list the categories checked.

---

## Reminder

This audit is intentionally narrow. If a finding is not on a hot path, not
measurable at realistic load, or not user-visible, drop it. The goal is to
produce a punch list a senior engineer would actually action.
`


const bughunterPerf = createMovedToPluginCommand({
  name: 'bughunter-perf',
  description:
    'Performance-focused bug hunt: hot-path complexity, sync I/O, leaks, N+1 queries',
  progressMessage: 'hunting for performance bugs…',
  pluginName: 'bughunter',
  pluginCommand: 'bughunter-perf',
  allowedTools: parseSlashCommandToolsFromFrontmatter(
    parseFrontmatter(BUGHUNTER_PERF_PROMPT).frontmatter['allowed-tools'],
  ),
  async getPromptWhileMarketplaceIsPrivate(args, context) {
    const scope =
      args?.trim() ||
      'the current project — focus on staged, unstaged, and recently committed files'
    const parsed = parseFrontmatter(BUGHUNTER_PERF_PROMPT)
    const allowedTools = parseSlashCommandToolsFromFrontmatter(
      parsed.frontmatter['allowed-tools'],
    )

    // Execute shell commands first ({{ARGS}} is inert to shell patterns),
    // then inject user-provided scope so shell snippets in args cannot execute.
    // On platforms without bash (e.g. Windows without Git Bash) or in a repo
    // where one git command fails (e.g. zero-commit `git log`), use the
    // granular fallback so a single failing snippet is blanked in place
    // rather than discarding the rest of the successful git context.
    // lineLimits bounds the diff snippet to 400 lines as the prompt advertises.
    let processedContent: string
    try {
      processedContent = await executeShellCommandsInPrompt(
        parsed.content,
        {
          ...context,
          getAppState: createGetAppStateWithAllowedTools(
            context.getAppState,
            allowedTools,
          ),
        },
        'bughunter-perf',
        undefined,
        {
          lineLimits: { 'git diff HEAD -- .': 400 },
          granularFallback: true,
        },
      )
    } catch (e) {
      // Permission denial and interruption — surface instead of falling back.
      if (e instanceof MalformedCommandError || (e instanceof ShellError && e.interrupted)) {
        throw e
      }
      // Granular fallback already blanked any failing snippets in place.
      throw e
    }

    const finalContent = processedContent.replace('{{ARGS}}', () => scope)
    return [{ type: 'text', text: finalContent }]
  },
})
export default bughunterPerf
