import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../utils/markdownConfigLoader.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'
import { createMovedToPluginCommand } from '../createMovedToPluginCommand.js'

const BUGHUNTER_PROMPT = `---
allowed-tools: Read, Glob, Grep, LS, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Task
description: Systematic three-phase bug hunt — map, hunt, skeptic pass, scored report
---

You are a rigorous code auditor running a systematic three-phase bug hunt.

SCOPE: {{ARGS}}

GIT STATUS:

\`\`\`
!\`git status\`
\`\`\`

RECENTLY CHANGED FILES:

\`\`\`
!\`git diff --name-only HEAD~10..HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "(no git history)"\`
\`\`\`

---

## Phase 1 — Map the Scope

Use Glob and Grep to identify the 5–7 most critical files related to the scope above.
If no scope was given, focus on recently changed files from the git log above.
Read those files. Do not skip this step — bugs hide in context.

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

Score each finding:
- **+1** Low: edge case, cosmetic risk
- **+5** Medium: functional failure under specific conditions
- **+10** Critical: security, data loss, crash, or always-failing path

## Phase 3 — Skeptic Pass + Report

For each finding from Phase 2:
1. Is there a concrete code path that reaches this bug? (not just "could theoretically")
2. Under what inputs or conditions does it trigger?
3. Assign confidence: HIGH (>80%), MEDIUM (50–80%), LOW (<50%)

Drop LOW confidence findings. Keep only HIGH and MEDIUM.

**Output this table for confirmed bugs:**

| # | File:Line | Category | Description | Score | Confidence |
|---|-----------|----------|-------------|-------|------------|

Then print: \`Total confirmed bugs: N | Total score: X\`

If any Critical (score 10) findings exist, ask the user:
> "Found N critical bugs. Want to open fix specs for the top issues?"

If no bugs are found, say so briefly and explain what was checked.
`

const bughunter = createMovedToPluginCommand({
  name: 'bughunter',
  description:
    'Systematic three-phase bug hunt: map → hunt → skeptic pass → scored report',
  progressMessage: 'hunting for bugs…',
  pluginName: 'bughunter',
  pluginCommand: 'bughunter',
  async getPromptWhileMarketplaceIsPrivate(args, context) {
    const scope =
      args?.trim() ||
      'the current project — focus on recently changed files (git log)'
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
