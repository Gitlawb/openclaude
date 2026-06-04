/**
 * OpenClaude build-time constants.
 *
 * These replace process.env checks that were only meaningful in the upstream
 * internal build. In OpenClaude all such gates are permanently disabled so
 * external users cannot activate internal code paths by setting env vars.
 */

/**
 * Always false in OpenClaude.
 * Replaces all `process.env.USER_TYPE === 'ant'` checks so that no external
 * user can activate internal-only features (commit attribution hooks,
 * system-prompt section clearing, dangerously-skip-permissions bypass, etc.)
 * by setting USER_TYPE in their shell environment.
 *
 * Exported as a const so bundlers can evaluate it at build time and
 * eliminate dead branches (dynamic imports, etc.) that are gated behind
 * this check.
 */
export const IS_ANT_EMPLOYEE = false as const

/** @deprecated Use IS_ANT_EMPLOYEE for build-time DCE; this function is kept for call-site convenience. */
export function isAntEmployee(): boolean {
  return IS_ANT_EMPLOYEE
}
