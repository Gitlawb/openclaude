/**
 * GitHub API rate-limit header tracking singleton.
 *
 * Updated after each API response when running with CLAUDE_CODE_USE_GITHUB=1.
 * Read at session end by the cost tracker to surface remaining quota.
 *
 * Headers parsed:
 *   x-ratelimit-limit-requests
 *   x-ratelimit-remaining-requests
 *   x-ratelimit-reset-requests
 *   x-ratelimit-limit-tokens
 *   x-ratelimit-remaining-tokens
 */

export interface GithubRateLimitState {
  limitRequests: number | null
  remainingRequests: number | null
  resetRequestsAt: Date | null
  limitTokens: number | null
  remainingTokens: number | null
}

const initialState: GithubRateLimitState = {
  limitRequests: null,
  remainingRequests: null,
  resetRequestsAt: null,
  limitTokens: null,
  remainingTokens: null,
}

let state: GithubRateLimitState = { ...initialState }

function parseIntOrNull(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null
  // Could be an epoch-seconds timestamp or an ISO date string
  const asNumber = Number(value)
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    // Epoch seconds — GitHub typically uses this format
    return new Date(asNumber * 1000)
  }
  const asDate = new Date(value)
  return Number.isNaN(asDate.getTime()) ? null : asDate
}

/**
 * Extract rate-limit information from a GitHub API response.
 * Only updates fields that are actually present in the headers.
 */
export function updateGithubRateLimit(headers: Headers): void {
  const limitReq = parseIntOrNull(headers.get('x-ratelimit-limit-requests'))
  const remainReq = parseIntOrNull(headers.get('x-ratelimit-remaining-requests'))
  const resetReq = parseDateOrNull(headers.get('x-ratelimit-reset-requests'))
  const limitTok = parseIntOrNull(headers.get('x-ratelimit-limit-tokens'))
  const remainTok = parseIntOrNull(headers.get('x-ratelimit-remaining-tokens'))

  if (limitReq !== null) state.limitRequests = limitReq
  if (remainReq !== null) state.remainingRequests = remainReq
  if (resetReq !== null) state.resetRequestsAt = resetReq
  if (limitTok !== null) state.limitTokens = limitTok
  if (remainTok !== null) state.remainingTokens = remainTok
}

/**
 * Returns a snapshot of the current rate-limit state.
 */
export function getGithubRateLimitState(): GithubRateLimitState {
  return { ...state }
}

/**
 * Formats the rate-limit state into a human-readable summary line.
 * Returns null if no rate-limit data has been observed yet.
 */
export function formatGithubRateLimitSummary(): string | null {
  const { limitRequests, remainingRequests, limitTokens, remainingTokens } = state

  const parts: string[] = []

  if (remainingRequests !== null && limitRequests !== null) {
    parts.push(`requests: ${remainingRequests}/${limitRequests} remaining`)
  } else if (remainingRequests !== null) {
    parts.push(`requests remaining: ${remainingRequests}`)
  }

  if (remainingTokens !== null && limitTokens !== null) {
    parts.push(`tokens: ${remainingTokens}/${limitTokens} remaining`)
  } else if (remainingTokens !== null) {
    parts.push(`tokens remaining: ${remainingTokens}`)
  }

  if (parts.length === 0) return null

  return `GitHub rate-limit: ${parts.join(', ')}`
}

/**
 * Resets state for testing purposes.
 */
export function resetGithubRateLimitState(): void {
  state = { ...initialState }
}
