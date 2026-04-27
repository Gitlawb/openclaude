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
 * src/services/policyLimits. Those two are INTENTIONALLY separate:
 *   - remoteManagedSettings: matches Python `json.dumps(sort_keys=True)`
 *     byte-for-byte to validate server-computed checksums. Must NOT
 *     drop undefined (Python preserves null).
 *   - policyLimits: uses `localeCompare` (keeps legacy behavior; locale-
 *     sensitive but stable for a given runtime).
 *   - this module (stableStringify): byte-identity for API body caching.
 *     Drops undefined to match `JSON.stringify` — the openaiShim/codexShim
 *     body is always downstream of `JSON.stringify` semantics.
 * Do not consolidate without auditing the 3 callers — each has a
 * different server-compat contract.
 */

/**
 * Returns a byte-stable JSON string representation.
 * - Object keys are emitted in lexicographic order at every depth.
 * - Array element order is preserved.
 * - Undefined values are dropped (matching `JSON.stringify`).
 * - Indentation matches the `space` argument (0 by default → compact).
 *
 * Native `JSON.stringify` pre-processing is preserved before sorting:
 *   - `toJSON(key)` is invoked on objects that define it (own or
 *     inherited — covers `Date`, `URL`, and any user class). The `key`
 *     argument is the property name for nested object values, the array
 *     index as a string for array elements, and `''` for the top-level
 *     call, matching native semantics.
 *   - Boxed primitive wrappers (`new Number(...)`, `new String(...)`,
 *     `new Boolean(...)`) are unboxed to their primitive form.
 * Both happen BEFORE the array/object branches dispatch, so the value
 * actually walked is the post-conversion form. If `toJSON` returns
 * `undefined`, the value is dropped from its parent (matching native
 * `JSON.stringify`).
 *
 * Single-pass: `deepSort` walks the (possibly converted) value tree
 * once, building a sorted clone. A `WeakSet` of ancestors tracks the
 * current path through the object graph so that circular references
 * throw `TypeError` (same contract as native `JSON.stringify`). The
 * cycle check runs on the post-`toJSON` value, so a `toJSON` impl that
 * returns an ancestor still throws. Ancestors are always removed in a
 * `finally` block when unwinding out of each object branch (even on
 * exception), so DAG inputs — where the same object is reachable via
 * multiple keys — are handled correctly and do not throw.
 */
export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(deepSort(value, new WeakSet(), ''), null, space)
}

/**
 * Returns a deep-sorted clone of the input: object keys lexicographic
 * at every depth, arrays preserved. Useful when callers need to feed
 * the sorted shape into a downstream serializer (e.g., when they must
 * call `JSON.stringify` with a custom spacing or replacer).
 *
 * Applies the same `toJSON(key)` invocation and primitive-wrapper
 * unboxing as `stableStringify`, so the returned shape mirrors what
 * native `JSON.stringify` would have walked.
 */
export function sortKeysDeep<T>(value: T): T {
  return deepSort(value, new WeakSet(), '') as T
}

function deepSort(
  value: unknown,
  ancestors: WeakSet<object>,
  key: string,
): unknown {
  // Step 1: invoke toJSON(key) if present — matches native pre-processing.
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    value = (value as { toJSON: (k: string) => unknown }).toJSON(key)
  }

  // Step 2: unbox primitive wrappers.
  if (value instanceof Number) value = Number(value)
  else if (value instanceof String) value = String(value)
  else if (value instanceof Boolean) value = Boolean(value.valueOf())

  // Step 3: primitives short-circuit (post-toJSON the value may now be one).
  if (value === null || typeof value !== 'object') return value

  // Step 4: arrays — element key is the index as a string.
  if (Array.isArray(value)) {
    return value.map((v, i) => deepSort(v, ancestors, String(i)))
  }

  // Step 5: cycle check on the post-toJSON value.
  if (ancestors.has(value as object)) {
    throw new TypeError('Converting circular structure to JSON')
  }
  ancestors.add(value as object)
  try {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const child = deepSort(
        (value as Record<string, unknown>)[k],
        ancestors,
        k,
      )
      if (child === undefined) continue
      sorted[k] = child
    }
    return sorted
  } finally {
    ancestors.delete(value as object)
  }
}

