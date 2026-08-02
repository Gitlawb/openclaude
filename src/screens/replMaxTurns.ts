import type { QueryTurnBudget } from '../query.js'

export {
  DEFAULT_REPL_MAX_TURNS,
  getReplMaxTurnsWarning,
  MAX_TURNS_CLI_DESCRIPTION,
  REPL_MAX_TURNS_OPTIONS,
  normalizeReplMaxTurns,
  resolveReplMaxTurns,
} from '../utils/replMaxTurns.js'

type MutableRef<T> = { current: T }

export function claimBackgroundTurnBudget(
  budgetRef: MutableRef<QueryTurnBudget | null>,
  handoffStartedRef: MutableRef<boolean>,
): QueryTurnBudget | null {
  if (!budgetRef.current || handoffStartedRef.current) return null
  handoffStartedRef.current = true
  return budgetRef.current
}

export function releaseForegroundTurnBudget(
  budgetRef: MutableRef<QueryTurnBudget | null>,
  handoffStartedRef: MutableRef<boolean>,
  ownedBudget: QueryTurnBudget,
): void {
  if (budgetRef.current !== ownedBudget) return
  budgetRef.current = null
  handoffStartedRef.current = false
}
