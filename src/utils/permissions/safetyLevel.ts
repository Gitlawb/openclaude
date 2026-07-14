/**
 * Tunable safety strictness.
 *
 * OpenClaude runs a number of "safety" checks: a model-level refusal directive
 * (see cyberRiskInstruction.ts), bash command-injection heuristics
 * (bashSecurity.ts), and sensitive-file / auto-edit guards (filesystem.ts).
 * Those checks are intentionally conservative, but several of them surface as
 * refusals or approval prompts for entirely benign, routine coding tasks
 * (e.g. editing `.gitmodules`, running a build script that contains `$(date)`,
 * or writing a port scanner for a CTF). See issue #1616.
 *
 * This module lets users dial the strictness without forking the behavior for
 * everyone:
 *   - "strict"    : current/default-equivalent non-permissive behavior.
 *   - "balanced"  : default. Same behavior as strict.
 *   - "permissive": relaxes the application-level heuristics that produce
 *                   false-positive refusals for benign tasks. The model-level
 *                   prompt is not weakened by this flag (use the prompt text
 *                   for that), but bash/file permission heuristics are eased.
 *
 * Driven by the OPENCLAUDE_SAFETY_LEVEL env var. Unknown values fall back to
 * "balanced".
 */

export type SafetyLevel = 'strict' | 'balanced' | 'permissive'

let cached: SafetyLevel | undefined
let cachedRaw: string | undefined

export function getSafetyLevel(): SafetyLevel {
  const raw = (process.env.OPENCLAUDE_SAFETY_LEVEL ?? '')
    .trim()
    .toLowerCase()
  if (cached && cachedRaw === raw) {
    return cached
  }
  cachedRaw = raw
  cached = raw === 'strict' || raw === 'permissive' ? raw : 'balanced'
  return cached
}

/** True when the application-level heuristics should be relaxed. */
export function isPermissiveSafety(): boolean {
  return getSafetyLevel() === 'permissive'
}

/** Test helper: reset the cached value so a new env var is picked up. */
export function resetSafetyLevelCache(): void {
  cached = undefined
  cachedRaw = undefined
}
