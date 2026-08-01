import { getGlobalConfig } from '../utils/config.js'

export const DEFAULT_REPL_MAX_TURNS = 50

/** Preset values offered in `/config` (plus any current custom value). */
export const REPL_MAX_TURNS_OPTIONS = [50, 100, 200, 500] as const

/**
 * Shared `--max-turns` help text for Commander registration and behavior tests.
 * Keep remote-backed sessions explicitly out of scope in this string.
 */
export const MAX_TURNS_CLI_DESCRIPTION =
  'Maximum number of agentic turns per prompt. In local interactive mode this overrides the default 50-turn REPL query cap (also configurable via OPENCLAUDE_MAX_TURNS or /config). Remote-backed sessions (connect/ssh/--remote) are not capped by this flag. In --print mode this early-exits after the specified number of turns.'

/**
 * Prefer OPENCLAUDE_MAX_TURNS; honor legacy CLAUDE_CODE_MAX_TURNS only when
 * the new variable is unset/empty. Invalid, zero, negative, non-integer, or
 * unsafe values are ignored (treated as absent for the chosen variable).
 */
function parsePositiveTurnEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw?.trim()) return undefined
  const parsed = Number(raw.trim())
  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed
  }
  return undefined
}

/**
 * Normalize a persisted or UI-selected interactive turn cap.
 * Invalid values fall back to DEFAULT_REPL_MAX_TURNS.
 */
export function normalizeReplMaxTurns(value: unknown): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value
    return DEFAULT_REPL_MAX_TURNS
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_REPL_MAX_TURNS
}

function resolveConfiguredReplMaxTurns(): number {
  const configured = getGlobalConfig().replMaxTurns
  if (configured === undefined) {
    return DEFAULT_REPL_MAX_TURNS
  }
  return normalizeReplMaxTurns(configured)
}

/**
 * Resolve the per-prompt local interactive REPL turn cap.
 *
 * Precedence: explicit prop (CLI `--max-turns`) → OPENCLAUDE_MAX_TURNS →
 * CLAUDE_CODE_MAX_TURNS (only if OPENCLAUDE_MAX_TURNS unset) →
 * `/config` `replMaxTurns` → DEFAULT_REPL_MAX_TURNS (50).
 *
 * Applies to local interactive query loops only. Remote-backed sessions
 * (connect/ssh/--remote) send prompts to a remote executor and are not
 * capped here.
 *
 * Invalid explicit values fall through so a bad CLI parse cannot disable the
 * interactive safety cap (unlike headless, where omitted maxTurns means no cap).
 * If OPENCLAUDE_MAX_TURNS is set but invalid, DEFAULT_REPL_MAX_TURNS is
 * used and lower layers (legacy env, /config) are not consulted — matching
 * OPENCLAUDE_MAX_RETRIES precedence.
 */
export function resolveReplMaxTurns(maxTurns?: number): number {
  if (
    typeof maxTurns === 'number' &&
    Number.isSafeInteger(maxTurns) &&
    maxTurns > 0
  ) {
    return maxTurns
  }

  const openClaudeRaw = process.env.OPENCLAUDE_MAX_TURNS
  if (openClaudeRaw?.trim()) {
    return parsePositiveTurnEnv('OPENCLAUDE_MAX_TURNS') ?? DEFAULT_REPL_MAX_TURNS
  }

  const legacy = parsePositiveTurnEnv('CLAUDE_CODE_MAX_TURNS')
  if (legacy !== undefined) {
    return legacy
  }

  return resolveConfiguredReplMaxTurns()
}
