/**
 * Read `API_TIMEOUT_MS` and return it only when it is a usable duration,
 * otherwise null so each caller can apply its own default.
 *
 * `parseInt` is far too permissive for this knob. It yields NaN for "abc",
 * stops at the first non-digit so "30s" becomes 30, and passes negatives
 * straight through. Every one of those reaches a timer as a delay, and both
 * NaN and negative delays are clamped to 0 — so a typo does not fall back to
 * the default, it makes every request time out immediately. The surfaced error
 * then reads "API_TIMEOUT_MS=30s ms, try increasing it", which points the user
 * away from the actual problem.
 *
 * Mirrors the validation getApiTimeoutMs already performs for the
 * OpenAI-compatible path: digits only, a safe integer, and strictly positive,
 * capped to what a timer can actually hold.
 *
 * The cap is not cosmetic. Every consumer ends up handing this value to
 * setTimeout, and Node coerces a delay above 2147483647 to 1ms, so an
 * over-large timeout aborts requests immediately instead of extending them --
 * the same "typo makes everything time out" failure this helper exists to
 * prevent, just from the other end of the range.
 */
export const MAX_API_TIMEOUT_MS = 2_147_483_647

/**
 * Default request timeout when `API_TIMEOUT_MS` is unset or invalid: 10 minutes,
 * the API's non-streaming boundary. Named here so the callers that fall back to
 * it (`parseApiTimeoutMsEnv() ?? DEFAULT_API_TIMEOUT_MS`) share one value rather
 * than repeating the literal.
 */
export const DEFAULT_API_TIMEOUT_MS = 600_000

export function parseApiTimeoutMsEnv(): number | null {
  const raw = process.env.API_TIMEOUT_MS?.trim()
  if (!raw || !/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
  return Math.min(parsed, MAX_API_TIMEOUT_MS)
}
