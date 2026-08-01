export const DEFAULT_REPL_MAX_TURNS = 50

/**
 * Prefer OPENCLAUDE_MAX_TURNS; honor legacy CLAUDE_CODE_MAX_TURNS when unset.
 * Invalid, zero, negative, non-integer, or unsafe values are ignored.
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
 * Resolve the per-prompt interactive REPL turn cap.
 *
 * Precedence: explicit prop (CLI `--max-turns`) → OPENCLAUDE_MAX_TURNS →
 * CLAUDE_CODE_MAX_TURNS → DEFAULT_REPL_MAX_TURNS (50).
 *
 * Invalid explicit values fall through so a bad CLI parse cannot disable the
 * interactive safety cap (unlike headless, where omitted maxTurns means no cap).
 */
export function resolveReplMaxTurns(maxTurns?: number): number {
  if (
    typeof maxTurns === 'number' &&
    Number.isSafeInteger(maxTurns) &&
    maxTurns > 0
  ) {
    return maxTurns
  }

  return (
    parsePositiveTurnEnv('OPENCLAUDE_MAX_TURNS') ??
    parsePositiveTurnEnv('CLAUDE_CODE_MAX_TURNS') ??
    DEFAULT_REPL_MAX_TURNS
  )
}
