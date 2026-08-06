import {
  createQueryTurnBudget,
  type QueryTurnBudget,
} from '../query.js'
import type { Terminal as QueryTerminal } from '../query/transitions.js'
import { getReplMaxTurnsWarning } from '../utils/replMaxTurns.js'

export {
  DEFAULT_REPL_MAX_TURNS,
  getReplMaxTurnsWarning,
  MAX_TURNS_CLI_DESCRIPTION,
  REPL_MAX_TURNS_OPTIONS,
  normalizeReplMaxTurns,
  resolveReplMaxTurns,
} from '../utils/replMaxTurns.js'

export function isLocalInteractiveMaxTurnsSession(session: {
  isRemoteSession: boolean
  directConnectConfig: unknown
  sshSession: unknown
}): boolean {
  return (
    !session.isRemoteSession &&
    !session.directConnectConfig &&
    !session.sshSession
  )
}

export function shouldShowReplMaxTurnsUnlimitedWarning(
  maxTurns: number | undefined,
  session: {
    isRemoteSession: boolean
    directConnectConfig: unknown
    sshSession: unknown
  },
): boolean {
  const warning = getReplMaxTurnsWarning(maxTurns)
  return warning !== undefined && isLocalInteractiveMaxTurnsSession(session)
}

export function shouldContinueBackgroundAfterForegroundQuery({
  didThrow,
  preflightVetoed,
  abortReason,
  queryTerminal,
}: {
  didThrow: boolean
  preflightVetoed: boolean
  abortReason: unknown
  queryTerminal: QueryTerminal | undefined
}): boolean {
  return (
    !didThrow &&
    !preflightVetoed &&
    abortReason === 'background' &&
    (queryTerminal?.reason === 'aborted_streaming' ||
      queryTerminal?.reason === 'aborted_tools')
  )
}

type MutableRef<T> = { current: T }

export type ForegroundTurnBudgetHandoff = {
  budget: QueryTurnBudget
  settled: Promise<boolean>
  settle: (shouldContinue: boolean) => void
}

export function createForegroundTurnBudgetHandoff(
  maxTurns?: number,
): ForegroundTurnBudgetHandoff {
  let resolveSettled!: (shouldContinue: boolean) => void
  let isSettled = false
  const settled = new Promise<boolean>(resolve => {
    resolveSettled = resolve
  })
  return {
    budget: createQueryTurnBudget(maxTurns),
    settled,
    settle: shouldContinue => {
      if (isSettled) return
      isSettled = true
      resolveSettled(shouldContinue)
    },
  }
}

export async function waitForForegroundTurnBudgetSettlement(
  handoff: ForegroundTurnBudgetHandoff,
  signal: AbortSignal,
): Promise<boolean | null> {
  if (signal.aborted) return null

  let resolveAborted!: () => void
  const aborted = new Promise<void>(resolve => {
    resolveAborted = resolve
  })
  const onAbort = () => resolveAborted()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([
      handoff.settled,
      aborted.then(() => null),
    ])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function claimBackgroundTurnBudget(
  budgetRef: MutableRef<ForegroundTurnBudgetHandoff | null>,
  handoffStartedRef: MutableRef<boolean>,
): ForegroundTurnBudgetHandoff | null {
  if (!budgetRef.current || handoffStartedRef.current) return null
  handoffStartedRef.current = true
  return budgetRef.current
}

export function releaseForegroundTurnBudget(
  budgetRef: MutableRef<ForegroundTurnBudgetHandoff | null>,
  handoffStartedRef: MutableRef<boolean>,
  ownedHandoff: ForegroundTurnBudgetHandoff,
  shouldContinue: boolean,
): void {
  // Always release waiters for this prompt, even if a newer prompt replaced
  // the foreground ref before the stale finally ran.
  ownedHandoff.settle(shouldContinue)
  if (budgetRef.current !== ownedHandoff) return
  budgetRef.current = null
  handoffStartedRef.current = false
}
