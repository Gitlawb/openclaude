import { logForDebugging } from '../debug.js'
import { CONTROL_CHAR_PATTERN } from '../validation.js'

/**
 * Git 2.30+ refuses to start when any environment value contains a NUL,
 * CR, or LF character ("Unsafe environment: control characters are not
 * allowed in values"). User shells frequently leak such values — a
 * copy-pasted API key with a trailing newline, or a terminal-set
 * variable with embedded escape sequences — which would otherwise break
 * every plugin clone or pull. We drop offending entries before forwarding
 * the environment to git.
 */
const GIT_UNSAFE_VALUE_RE = CONTROL_CHAR_PATTERN

const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0', // Prevent terminal credential prompts
  GIT_ASKPASS: '', // Disable askpass GUI programs
}

let warnedAboutDroppedEnvKeys = false

/**
 * Returns a copy of `env` with any entries whose key OR value contains
 * a NUL/CR/LF removed. The list of dropped key names is returned so
 * callers can log it without exposing the (possibly secret) values.
 */
export function sanitizeEnvForGit(
  env: NodeJS.ProcessEnv,
): { env: NodeJS.ProcessEnv; dropped: string[] } {
  const sanitized: NodeJS.ProcessEnv = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (GIT_UNSAFE_VALUE_RE.test(key) || GIT_UNSAFE_VALUE_RE.test(value)) {
      dropped.push(key)
      continue
    }
    sanitized[key] = value
  }
  return { env: sanitized, dropped }
}

/**
 * Build the environment object passed to a git child process. Merges
 * `process.env` with the no-prompt overrides and any caller extras,
 * then strips entries that would trigger git's unsafe-value check. The
 * first batch of dropped key names is logged once per process so the
 * user can clean them up in their shell.
 */
export function buildGitChildEnv(
  extras?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const merged = { ...process.env, ...GIT_NO_PROMPT_ENV, ...(extras ?? {}) }
  const { env, dropped } = sanitizeEnvForGit(merged)
  if (dropped.length > 0 && !warnedAboutDroppedEnvKeys) {
    warnedAboutDroppedEnvKeys = true
    logForDebugging(
      `git child env: dropped ${dropped.length} key(s) containing control characters: ${dropped.join(', ')}. Git 2.30+ rejects them; clean these up in your shell to forward them to git.`,
      { level: 'warn' },
    )
  }
  return env
}

/**
 * Test-only escape hatch that resets the once-per-process warning flag
 * so unit tests can exercise the warning path repeatedly.
 */
export function __resetGitEnvWarningForTesting(): void {
  warnedAboutDroppedEnvKeys = false
}
