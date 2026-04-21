/**
 * Deterministic JSON serialization.
 *
 * WHY: OpenAI / Kimi / DeepSeek / Codex all use **implicit prefix caching**
 * — the server hashes the request prefix and reuses cached reasoning if
 * the bytes match exactly. Even a trivial key-order difference between
 * two otherwise-identical requests invalidates the hash and forces a
 * full re-parse.
 *
 * This is also a pre-requisite for Anthropic / Bedrock / Vertex
 * `cache_control` breakpoints: ephemeral cache entries match on exact
 * content, so a re-ordered object literal busts the breakpoint.
 *
 * `JSON.stringify` is nondeterministic across engines and across
 * successive iterations when objects carry keys added at different
 * times (V8 preserves insertion order, which is the common failure
 * mode when building a body from spread-merged configs).
 *
 * This helper recursively sorts object keys. Arrays preserve order
 * (element order IS semantically significant in message/content arrays).
 *
 * Complements `sortKeysDeep` in src/services/remoteManagedSettings and
 * src/services/policyLimits — those are settings-specific; this one is
 * for the API request body.
 */

/**
 * Returns a byte-stable JSON string representation.
 * - Object keys are emitted in lexicographic order at every depth.
 * - Array element order is preserved.
 * - Undefined values are dropped (matching `JSON.stringify`).
 * - Indentation matches the `space` argument (0 by default → compact).
 */
export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, sortingReplacer, space)
}

/**
 * Returns a deep-sorted clone of the input: object keys lexicographic
 * at every depth, arrays preserved. Useful when callers need to feed
 * the sorted shape into a downstream serializer (e.g., when they must
 * call `JSON.stringify` with a custom spacing or replacer).
 */
export function sortKeysDeep<T>(value: T): T {
  return deepSort(value) as T
}

function deepSort(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(deepSort)
  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(value as Record<string, unknown>).sort()
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key]
    if (v === undefined) continue
    sorted[key] = deepSort(v)
  }
  return sorted
}

// JSON.stringify replacer that sorts object keys at every depth.
function sortingReplacer(_key: string, val: unknown): unknown {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return val
  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(val as Record<string, unknown>).sort()
  for (const k of keys) {
    const v = (val as Record<string, unknown>)[k]
    if (v === undefined) continue
    sorted[k] = v
  }
  return sorted
}

/**
 * Simple fast non-cryptographic 32-bit hash. Used to detect content
 * drift in attachment delta scanners where the full content is stored
 * elsewhere and we only need to answer "has this changed?".
 *
 * FNV-1a 32-bit. Good enough for collision probabilities at our scale
 * (a few hundred attachments per session); avoids pulling in `crypto`
 * on the hot path.
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
