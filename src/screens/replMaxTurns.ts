export const DEFAULT_REPL_MAX_TURNS = 50

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
 * Resolve the per-prompt local interactive REPL turn cap.
 *
 * Precedence: explicit prop (CLI `--max-turns`) → OPENCLAUDE_MAX_TURNS →
 * CLAUDE_CODE_MAX_TURNS (only if OPENCLAUDE_MAX_TURNS unset) →
 * DEFAULT_REPL_MAX_TURNS (50).
 *
 * Applies to local interactive query loops only. Remote-backed sessions
 * (connect/ssh/--remote) send prompts to a remote executor and are not
 * capped here.
 *
 * Invalid explicit values fall through so a bad CLI parse cannot disable the
 * interactive safety cap (unlike headless, where omitted maxTurns means no cap).
 * If OPENCLAUDE_MAX_TURNS is set but invalid, the default is used (legacy is
 * not consulted), matching OPENCLAUDE_MAX_RETRIES precedence.
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

  return parsePositiveTurnEnv('CLAUDE_CODE_MAX_TURNS') ?? DEFAULT_REPL_MAX_TURNS
}
