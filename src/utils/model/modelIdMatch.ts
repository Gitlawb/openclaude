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
  const next = name[index + id.length]
  return (
    next === undefined ||
    next === '-' ||
    next === '@' ||
    next === '?' ||
    next === '['
  )
}

/**
 * Normalize the underscore form some providers and user-typed settings use
 * (`claude_opus_5`) so one matcher covers both spellings.
 */
function normalizeModelId(name: string): string {
  return name.toLowerCase().replaceAll('_', '-')
}

// @[MODEL LAUNCH]: Add the new model's family fragment here rather than adding
// another substring check at the call site.
function matchesModelFragment(name: string, fragment: string): boolean {
  return matchesModelIdAtBoundary(normalizeModelId(name), fragment)
}

/**
 * Claude Opus 5, in any provider spelling (`claude-opus-5`,
 * `us.anthropic.claude-opus-5-v1:0`, `claude-opus-5@20260501`,
 * `claude-opus-5[1m]`). Also accepts the canonical short name, so callers that
 * already hold `getCanonicalName(model)` can pass it straight through.
 */
export function isOpus5ModelId(name: string): boolean {
  return matchesModelFragment(name, 'opus-5')
}

/** Claude Sonnet 5 — see {@link isOpus5ModelId}. */
export function isSonnet5ModelId(name: string): boolean {
  return matchesModelFragment(name, 'sonnet-5')
}

/** Either Claude 5 model. */
export function isClaude5ModelId(name: string): boolean {
  return isOpus5ModelId(name) || isSonnet5ModelId(name)
}
