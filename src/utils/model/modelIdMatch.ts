/**
 * Boundary-aware model-id matching, shared by every consumer that has to decide
 * "is this that model?" — canonicalization, request shaping, capability gates,
 * pricing, and UI copy.
 *
 * A plain `includes()`/`startsWith()` check folds near matches such as
 * `claude-opus-50` or `claude-opus-5x` into the real entry, which then inherits
 * that model's pricing, adaptive thinking, 1M context, and effort levels. Every
 * new model launch must reuse the helpers here instead of adding another
 * substring check.
 */

/**
 * True when `id` occurs in `name` as a complete id rather than as the prefix of
 * a longer version. Provider ids may prefix the id (`us.anthropic.` …,
 * `opencode-` …), so only the delimiters that follow a complete id are
 * accepted: provider/date suffixes (`-`), Vertex dates (`@`), query options
 * (`?`), and the context tag (`[`). Without this, `claude-opus-50` reads as
 * `claude-opus-5`.
 */
export function matchesModelIdAtBoundary(name: string, id: string): boolean {
  const index = name.indexOf(id)
  if (index === -1) {
    return false
  }
  const previous = name[index - 1]
  const next = name[index + id.length]
  return (
    (previous === undefined || !/[a-z0-9]/i.test(previous)) &&
    (next === undefined ||
      next === '-' ||
      next === '@' ||
      next === '?' ||
      next === '[')
  )
}

// @[MODEL LAUNCH]: Add the new model's family fragment here rather than adding
// another substring check at the call site.
//
// Hyphenated spelling only. No provider emits an underscore model id, so
// accepting `claude_opus_5` here would hand it Claude 5 capabilities while
// firstPartyNameToCanonical() still saw an unknown model and priced it as one.
// The two 3P fallback-suggestion helpers accept legacy underscore aliases
// through the dedicated boundary-aware helpers below.
function matchesModelFragment(name: string, fragment: string): boolean {
  return matchesModelIdAtBoundary(name.toLowerCase(), fragment)
}

/**
 * Claude Opus 5, in any provider spelling (`claude-opus-5`,
 * `us.anthropic.claude-opus-5-v1:0`, `claude-opus-5@20260501`,
 * `claude-opus-5[1m]`). Matches the same `claude-opus-5` identity
 * `firstPartyNameToCanonical()` uses, so a custom id such as
 * `arbitrary-proxy-opus-5` is not granted Claude 5 capabilities.
 */
export function isOpus5ModelId(name: string): boolean {
  return matchesModelFragment(name, 'claude-opus-5')
}

/** Claude Sonnet 5 — see {@link isOpus5ModelId}. */
export function isSonnet5ModelId(name: string): boolean {
  return matchesModelFragment(name, 'claude-sonnet-5')
}

/** Claude Opus 5 or its legacy underscore alias, for 3P fallback only. */
export function isOpus5FallbackModelId(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    isOpus5ModelId(normalized) ||
    matchesModelIdAtBoundary(normalized, 'opus_5')
  )
}

/** Claude Sonnet 5 or its legacy underscore alias, for 3P fallback only. */
export function isSonnet5FallbackModelId(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    isSonnet5ModelId(normalized) ||
    matchesModelIdAtBoundary(normalized, 'sonnet_5')
  )
}

/** Either Claude 5 model. */
export function isClaude5ModelId(name: string): boolean {
  return isOpus5ModelId(name) || isSonnet5ModelId(name)
}
