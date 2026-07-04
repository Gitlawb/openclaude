export type AbortReason =
  | 'query-timeout'
  | 'hard-max-query-timeout'
  | 'user-abort'
  | 'interrupt'
  | 'background'
  | 'side-task-cancelled'
  | 'tool-timeout'
  | 'parent-ended'
  | 'unknown-abort'

const KNOWN_ABORT_REASONS = new Set<string>([
  'query-timeout',
  'hard-max-query-timeout',
  'user-abort',
  'interrupt',
  'background',
  'side-task-cancelled',
  'tool-timeout',
  'parent-ended',
  'unknown-abort',
])

const ABORT_REASON_ALIASES: Record<string, AbortReason> = {
  'user-cancel': 'user-abort',
  hard_max: 'hard-max-query-timeout',
  streaming_fallback: 'side-task-cancelled',
  sibling_error: 'side-task-cancelled',
}

export function normalizeAbortReason(reason: unknown): AbortReason {
  if (typeof reason === 'string') {
    const aliasedReason = ABORT_REASON_ALIASES[reason]
    if (aliasedReason) {
      return aliasedReason
    }
    return KNOWN_ABORT_REASONS.has(reason)
      ? (reason as AbortReason)
      : 'unknown-abort'
  }

  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return 'tool-timeout'
  }

  return 'unknown-abort'
}

export function isQueryLevelAbort(reason: AbortReason): boolean {
  return reason !== 'tool-timeout'
}

export function getShellAbortMessage(reason: AbortReason): string {
  switch (reason) {
    case 'query-timeout':
      return 'Command was interrupted because the query hit its timeout.'
    case 'hard-max-query-timeout':
      return 'Command was interrupted because the query hit its hard timeout.'
    case 'background':
      return 'Command was interrupted because the enclosing query was backgrounded.'
    case 'side-task-cancelled':
      return 'Command was interrupted because a side task was cancelled.'
    case 'tool-timeout':
      return 'Command timed out before completion.'
    case 'user-abort':
      return 'Command was interrupted because the enclosing query was aborted.'
    case 'interrupt':
      return 'Command was interrupted because the enclosing query was aborted.'
    case 'parent-ended':
      return 'Command was interrupted because the enclosing query was aborted.'
    case 'unknown-abort':
      return 'Command was interrupted because the enclosing query was aborted.'
  }
}

export function getStreamingAbortMessage(
  reason: unknown,
  errorText: string,
): string {
  switch (normalizeAbortReason(reason)) {
    case 'user-abort':
      return `Streaming aborted by user: ${errorText}`
    case 'interrupt':
      return `Streaming aborted by submit interrupt: ${errorText}`
    case 'query-timeout':
      return `Streaming aborted by query timeout: ${errorText}`
    case 'hard-max-query-timeout':
      return `Streaming aborted by query hard timeout: ${errorText}`
    case 'background':
      return `Streaming aborted for backgrounding: ${errorText}`
    case 'side-task-cancelled':
      return `Streaming aborted because side task was cancelled: ${errorText}`
    case 'tool-timeout':
      return `Streaming aborted because tool timed out: ${errorText}`
    case 'parent-ended':
      return `Streaming aborted because parent query ended: ${errorText}`
    case 'unknown-abort':
      return `Streaming aborted by parent signal: ${errorText}`
  }
}

export function shouldCreateUserInterruptionMessage(reason: unknown): boolean {
  if (normalizeAbortReason(reason) === 'user-abort') {
    return true
  }

  // AbortController.abort() without an explicit reason was historically used
  // for user cancellation in some entrypoints. Preserve that legacy signal,
  // while explicit timeout/background reasons remain non-user aborts.
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { name?: unknown }).name === 'AbortError'
  )
}

export function getQueryAbortSystemMessage(reason: unknown): string | null {
  switch (normalizeAbortReason(reason)) {
    case 'query-timeout':
      return 'Query timed out before completion.'
    case 'hard-max-query-timeout':
      return 'Query reached the hard maximum runtime and was stopped before completion.'
    case 'background':
      return 'Query was backgrounded before completion.'
    case 'side-task-cancelled':
      return 'Query stopped because a side task was cancelled.'
    case 'parent-ended':
      return 'Query stopped because the parent query ended.'
    default:
      return null
  }
}

export function getMissingToolResultAbortMessage(reason: unknown): string {
  switch (normalizeAbortReason(reason)) {
    case 'user-abort':
      return 'Interrupted by user'
    case 'interrupt':
      return 'Interrupted by submit interrupt'
    case 'query-timeout':
      return 'Tool use was interrupted because the query timed out.'
    case 'hard-max-query-timeout':
      return 'Tool use was interrupted because the query reached its hard maximum runtime.'
    case 'background':
      return 'Tool use was interrupted because the query was backgrounded.'
    case 'side-task-cancelled':
      return 'Tool use was interrupted because a side task was cancelled.'
    case 'tool-timeout':
      return 'Tool use timed out before completion.'
    case 'parent-ended':
      return 'Tool use was interrupted because the parent query ended.'
    case 'unknown-abort':
      return 'Tool use was interrupted because the query was aborted.'
  }
}
