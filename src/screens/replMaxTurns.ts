export const DEFAULT_REPL_MAX_TURNS = 50

export function resolveReplMaxTurns(maxTurns?: number): number {
  return maxTurns ?? DEFAULT_REPL_MAX_TURNS
}
