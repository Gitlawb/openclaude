import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../utils/markdownConfigLoader.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'
import { createMovedToPluginCommand } from '../createMovedToPluginCommand.js'

const BUGHUNTER_PROMPT = `---
allowed-tools: Read, Glob, Grep, LS, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)
description: Systematic four-phase bug hunt — map, hunt, skeptic pass, fix proposal
---

You are a rigorous code auditor running a systematic bug hunt on a real codebase.

SCOPE: {{ARGS}}

GIT STATUS:

\`\`\`
!\`git status\`
\`\`\`

UNSTAGED CHANGES (working tree):

\`\`\`
!\`git diff --name-only --diff-filter=AM 2>/dev/null || true\`
\`\`\`

STAGED CHANGES (index):

\`\`\`
!\`git diff --cached --name-only --diff-filter=AM 2>/dev/null || true\`
\`\`\`

RECENTLY COMMITTED FILES (last 10 commits):

\`\`\`
!\`git diff --name-only HEAD~10..HEAD --diff-filter=AM 2>/dev/null || git ls-files | head -50 || echo "(no git history)"\`
\`\`\`

DIFF OF UNSTAGED + STAGED CHANGES:

\`\`\`
!\`git diff HEAD -- . 2>/dev/null | head -400 || true\`
\`\`\`

---

## Phase 1 — Map the Scope

Use Glob and Grep to identify the 5–7 most critical files related to the scope above.
If no scope was given, focus on the files in the staged + unstaged + recent-commit
buckets above. Read those files. Do not skip this step — bugs hide in context, and
the diff blocks above are a starting point, not the whole story.

## Phase 2 — Hunt

Examine the code systematically. Look for:

**Logic errors**
- Off-by-one (loop bounds, slice/splice indices, pagination)
- Inverted conditions (=== vs !==, < vs <=, && vs ||)
- Incorrect default values or missing guards

**Async / concurrency**
- Missing await on promises
- Race conditions in state mutation
- Unhandled rejected promises or uncaught exceptions in async flows

**Error handling**
- I/O, network, and database calls with no error handling
- Silent swallows (\`catch (_) {}\`)
- Error paths that return undefined where a value is expected

**Security**
- Command injection, SQL injection, path traversal
- Hardcoded secrets or tokens
- Unvalidated user input reaching sensitive operations
- Exposed internal state in API responses

**Type / null safety**
- Null/undefined dereferences without guards
- Incorrect type casts or \`as any\` hiding real type errors
- Optional chaining gaps (\`obj.a.b\` where \`obj.a\` may be undefined)

**Data consistency**
- Missing transactions around multi-step writes
- Stale reads after write (cache coherence)
- Off-by-one in pagination or cursor logic

Score each finding against the rubric:
- **+1** Low: edge case, cosmetic risk
- **+5** Medium: functional failure under specific conditions
- **+10** Critical: security, data loss, crash, or always-failing path

## Phase 3 — Skeptic Pass

For each finding from Phase 2, answer all three:
1. Is there a **concrete code path** that reaches this bug? (not "could theoretically")
2. Under what **specific inputs or conditions** does it trigger?
3. Assign confidence:
   - **HIGH** (>80%): clear path, well-defined trigger
   - **MEDIUM** (50–80%): plausible path, conditions documented
   - **LOW** (<50%): speculative, missing a step, or theoretical

**Drop all LOW confidence findings.** Keep only HIGH and MEDIUM.

## Phase 4 — Fix Proposals

For every surviving finding, write a **concrete code-level fix** as a 3–8 line patch
sketch. Use the actual function signature, the actual variable names from the
codebase, and the actual import style. Do not write a paragraph — write code.

If you cannot produce a concrete patch (because the fix is structural, requires
schema migration, or touches more than ~10 lines), say so explicitly and explain
what the user would need to decide before you can sketch it.

---

## Hard Exclusions — Automatically Skip

Do not report findings in any of these categories:
1. Lack of input validation on non-critical fields without proven exploit path
2. Theoretical race conditions or timing attacks (only flag if concretely problematic)
3. Memory consumption or CPU exhaustion issues
4. Logging concerns (log level, structured vs unstructured, PII) — only flag if it
   leaks secrets, passwords, or PII to a remote sink
5. Regex injection or regex DoS
6. Documentation files (*.md) — bugs in docs are not code bugs
7. Test files — bugs in tests are not production bugs (note them in passing only)
8. Outdated third-party libraries — managed separately
9. Memory safety issues in Rust or other memory-safe languages
10. A lack of audit logging is not a bug
11. Code style, naming, formatting — never report
12. "This could be a problem in 5 years" speculative maintenance concerns
13. Suggestions to add TypeScript types to JavaScript files (or vice versa)
14. Missing JSDoc / inline comments

## Output Format

**Step 1 — Summary line:**
\`Total confirmed bugs: N | Critical: C | Medium: M | Total weighted score: X\`

Where weighted score is the sum of (10 × C) + (5 × M) + (1 × L) for any kept
LOW-confidence findings (these stay reported but flagged). Critical = score 10,
Medium = score 5, Low = score 1.

**Step 2 — Findings table:**

| # | File:Line | Severity | Confidence | Category | Description | Fix sketch |
|---|-----------|----------|------------|----------|-------------|------------|
| 1 | src/foo.ts:42 | Critical | HIGH | async | Missing await on saveUser(...) | \`await saveUser(user)\` then return |
| 2 | src/bar.ts:17 | Medium | MEDIUM | error-handling | Empty catch swallows DB error | \`catch (e) { log.error(e); throw }\` |

The Fix sketch column MUST be code, not prose. If you cannot sketch code, write
\`FIX: requires design decision — see note below\` and add a note.

**Step 3 — Critical follow-up:**

If any Critical (score 10) findings exist, ask the user:
> "Found N critical bugs. Want to open fix specs for the top issues?"

If no bugs are found, say so briefly and list what was checked.
`

const bughunter = createMovedToPluginCommand({
  name: 'bughunter',
  description:
    'Systematic four-phase bug hunt: map → hunt → skeptic pass → fix proposals',
  progressMessage: 'hunting for bugs…',
  pluginName: 'bughunter',
  pluginCommand: 'bughunter',
  async getPromptWhileMarketplaceIsPrivate(args, context) {
    const scope =
      args?.trim() ||
      'the current project — focus on staged, unstaged, and recently committed files'
    const rawPrompt = BUGHUNTER_PROMPT.replace('{{ARGS}}', scope)

    const parsed = parseFrontmatter(rawPrompt)
    const allowedTools = parseSlashCommandToolsFromFrontmatter(
      parsed.frontmatter['allowed-tools'],
    )

    const processedContent = await executeShellCommandsInPrompt(
      parsed.content,
      {
        ...context,
        getAppState() {
          const appState = context.getAppState()
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                command: allowedTools,
              },
            },
          }
        },
      },
      'bughunter',
    )

    return [{ type: 'text', text: processedContent }]
  },
})

export default bughunter
