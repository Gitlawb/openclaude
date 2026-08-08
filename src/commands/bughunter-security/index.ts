import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { createGetAppStateWithAllowedTools } from '../../utils/forkedAgent.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../utils/markdownConfigLoader.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'
import { MalformedCommandError, ShellError } from '../../utils/errors.js'
import { createMovedToPluginCommand } from '../createMovedToPluginCommand.js'

const BUGHUNTER_SECURITY_PROMPT = `---
allowed-tools: Read, Glob, Grep, LS, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)
description: Security-focused bug hunt — exploit-driven, OWASP-aligned, confidence-gated
---

You are a senior application security engineer running a focused security audit on
a real codebase. This is a sibling of \`/bughunter\`, narrowed to security findings
only. It is **not** a general code review.

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

## Phase 1 — Map the Attack Surface

Use Glob and Grep to identify the 5–7 most critical files for the scope above.
If no scope was given, focus on staged + unstaged + recent-commit buckets.
**If git context is empty, use Glob/Grep to find security-relevant files:**
- Entry points (API routes, handlers, controllers, CLI commands)
- Auth/middleware code
- Data validation/sanitization layers
- Database/query builders
- Config/secret handling
- File upload/processing code

**Specifically map:**
- Trust boundaries (network ingress, IPC, deserialization sinks, file uploads)
- Data flow from user-controllable input to sensitive operations
- Authentication / authorization decision points
- Secret material at rest or in transit
- Process invocation and shell-out sites
- Template / query / DOM rendering sinks

Read the surrounding code, not just the diff. Bugs hide in context.

## Phase 2 — Hunt (OWASP-Aligned Categories)

**A1 — Injection**
- SQL injection (string concatenation, unparameterized queries)
- NoSQL injection (object operators in Mongo queries, etc.)
- Command injection in \`exec\` / \`spawn\` / shell calls
- Template injection in user-rendered templates
- LDAP / XPath / log injection where input reaches the sink

**A2 — Authentication & Session**
- Missing or weak authentication on sensitive endpoints
- Authentication bypass logic (header checks, IP-based trust)
- Session fixation, IDOR, JWT algorithm confusion (\`alg: none\`, key confusion)
- Privilege escalation paths (role checks, ownership checks)
- Missing authorization on internal-only endpoints

**A3 — Sensitive Data Exposure**
- Hardcoded API keys, passwords, tokens, private keys
- PII or secrets written to logs / error responses / telemetry
- Sensitive data in URL paths or query strings (server logs)
- Missing encryption at rest or in transit
- Debug information exposure in production responses

**A4 — XML / Deserialization**
- XXE in XML parsers (entity expansion, external entity)
- Unsafe deserialization (\`pickle\`, \`yaml.load\`, \`eval\` on input, \`unserialize\`)
- Prototype pollution via deep-merge of untrusted input

**A5 — Access Control / SSRF**
- SSRF where attacker controls host or protocol (NOT just path)
- Path traversal in file operations (\`../\` escape, symlink following)
- Open redirects with concrete exploitation path
- CORS misconfiguration allowing credentialed cross-origin
- WebSocket hijacking via missing origin checks

**A7 — Cross-Site Scripting**
- Reflected / stored / DOM-based XSS in raw HTML contexts
- \`dangerouslySetInnerHTML\`, \`bypassSecurityTrustHtml\`, \`v-html\` with user input
- Server-side template injection rendering user input
- CSP bypasses via inline scripts or JSONP

**A8 — Software & Data Integrity**
- Unsigned or weakly-signed updates / plugins
- CI/CD pipeline injection (GitHub Actions with untrusted input)
- Insecure deserialization in supply chain context

**A9 — Logging & Monitoring Failures**
- Security events not logged (auth failures, privilege escalation, money movement)
- Logs that can be injected (CRLF / log forging allowing forgery of audit trail)
- Only flag if it **enables an attack**, not as a generic "add more logging" finding

**A10 — SSRF (consolidated)**
- Already covered under A5; same threshold applies

## Phase 3 — Exploit-Driven Skeptic Pass

For each candidate, answer ALL three before reporting:

1. **Concrete path**: Trace data from an attacker-controllable source to the
   vulnerable sink. A candidate without a clear path is dropped.
2. **Specific trigger**: What request, payload, or condition causes the bug?
   No "could theoretically" or "depends on usage" hand-waving.
3. **Confidence score (1–10)**:
   - **8–10** (HIGH): Clear path, well-defined trigger, known exploitation pattern
   - **5–7** (MEDIUM): Plausible path, conditions documented, exploitation requires effort
   - **1–4** (LOW): Speculative, missing a step, or theoretical only

**Drop all findings with confidence < 8.** This audit is intentionally strict;
better to miss a possible issue than flood the report with low-confidence noise.

## Phase 4 — Fix Proposals

For every surviving finding, write a **concrete patch sketch** using actual
function signatures, variable names, and import style from the codebase.

If the fix is structural (requires schema migration, framework change, or >10
lines of refactor), say so explicitly and state what the user would need to
decide before sketching.

---

## Hard Exclusions — Automatically Skip

Do not report findings in any of these categories:

1. DoS, rate limiting, or resource exhaustion (any severity)
2. Secrets stored on disk in a secured location (handled by other processes)
3. Theoretical race conditions or timing attacks
4. Memory consumption or CPU exhaustion issues
5. Lack of input validation on non-security-critical fields without proven exploit
6. Input sanitization in GitHub Action workflows unless clearly triggerable via
   untrusted input
7. Lack of hardening measures (code is not expected to implement all best practices)
8. Vulnerabilities in outdated third-party libraries (managed separately)
9. Memory safety issues in Rust or any memory-safe language
10. Test files (*.test.ts, *.spec.ts, __tests__/) — not production code
11. Log spoofing or log forging concerns unless there is a concrete, demonstrable path to forge or manipulate log entries or structured log fields in a way that enables forgery of the audit trail — merely outputting unsanitized user input to logs is not sufficient
12. SSRF that only controls the path (only flag if it controls host or protocol)
13. User-controlled content in AI system prompts
14. Regex injection
15. Regex DoS
16. Documentation files (*.md) — bugs in docs are not security bugs
17. Lack of audit logging is not a security bug
18. Client-side JS/TS missing permission checks (server is responsible for auth)
19. UUID guessability — assume UUIDs are unguessable
20. Environment variable and CLI flag trust (env is trusted in secure environments)
21. React / Angular XSS without \`dangerouslySetInnerHTML\` / \`bypassSecurityTrustHtml\`
22. Subtle low-impact web vulns (tabnabbing, XS-Leaks, prototype pollution, open
    redirects) unless extremely high confidence
23. Resource management issues (memory / FD leaks)
24. Code style, naming, formatting

## Output Format

**Step 1 — Summary line:**
\`Total confirmed vulnerabilities: N | High: H | Medium: M | Confidence threshold: 8/10\`

Where counts are after the skeptic pass. **All findings must have confidence ≥ 8.**

**Step 2 — Findings table:**

| # | File:Line | Severity | Confidence | CWE | Exploit | Fix sketch |
|---|-----------|----------|------------|-----|---------|------------|
| 1 | src/foo.ts:42 | High | 9 | CWE-89 | q=\`OR 1=1--\` → dump | Use parameterized query: \`db.query('SELECT … WHERE id = $1', [id])\` |
| 2 | src/bar.ts:17 | Medium | 8 | CWE-200 | Verbose error leaks stack trace | Catch + return generic \`{ error: 'internal' }\` in prod |

The Exploit column must show the **specific payload or request** that triggers
the bug. The Fix sketch column must be **code**, not prose.

**Step 3 — Required follow-up:**

> "Found N security findings (H high, M medium). Want to open a fix spec for each?"

If no findings, say so and list the categories checked.

---

## Signal Quality Reminder

For each surviving finding, ask:
- Is there a concrete, exploitable vulnerability with a clear attack path?
- Does this represent real risk vs theoretical best practice?
- Are there specific code locations and reproduction steps?
- Would a security team action this finding in a PR review?

If any answer is "no", drop the finding.
`


const bughunterSecurity = createMovedToPluginCommand({
  name: 'bughunter-security',
  description:
    'Security-focused bug hunt: exploit-driven, OWASP-aligned, confidence ≥ 8',
  progressMessage: 'hunting for security bugs…',
  pluginName: 'bughunter',
  pluginCommand: 'bughunter-security',
  allowedTools: parseSlashCommandToolsFromFrontmatter(
    parseFrontmatter(BUGHUNTER_SECURITY_PROMPT).frontmatter['allowed-tools'],
  ),
  async getPromptWhileMarketplaceIsPrivate(args, context) {
    const scope =
      args?.trim() ||
      'the current project — focus on staged, unstaged, and recently committed files'
    const parsed = parseFrontmatter(BUGHUNTER_SECURITY_PROMPT)
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
        'bughunter-security',
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
export default bughunterSecurity
