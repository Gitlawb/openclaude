export type AbortReason =
  | 'query-timeout'
  | 'hard-max-query-timeout'
  | 'user-abort'
  | 'interrupt'
  | 'background'
  | 'tool-timeout'
  | 'parent-ended'
  | 'unknown-abort'

const KNOWN_ABORT_REASONS = new Set<string>([
  'query-timeout',
  'hard-max-query-timeout',
  'user-abort',
  'interrupt',
  'background',
  'tool-timeout',
  'parent-ended',
  'unknown-abort',
])

const ABORT_REASON_ALIASES: Record<string, AbortReason> = {
  'user-cancel': 'user-abort',
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
