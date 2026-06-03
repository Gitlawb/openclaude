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
 * Compact output is emitted directly in sorted-key order instead of first
 * building a full sorted clone. A `WeakSet` of ancestors tracks the current
 * path through the object graph so that circular references throw `TypeError`
 * (same contract as native `JSON.stringify`). The cycle check runs on the
 * post-`toJSON` value, so a `toJSON` impl that returns an ancestor still
 * throws. Ancestors are always removed in a `finally` block when unwinding out
 * of each object branch (even on exception), so DAG inputs — where the same
 * object is reachable via multiple keys — are handled correctly and do not
 * throw.
 */
export function stableStringify(
  value: unknown,
  space?: number,
): string | undefined {
  // Pretty printing is used only in tests/debug helpers. Keep it on the
  // native JSON.stringify path so spacing behavior stays exactly native.
  if (space !== undefined && space >= 1) {
    return JSON.stringify(deepSort(value, new WeakSet(), ''), null, space)
  }
  return stringifyStable(value, new WeakSet(), '')
}

export function stableStringifyJson(value: unknown, space?: number): string {
  const serialized = stableStringify(value, space)
  if (serialized === undefined) {
    throw new TypeError(
      'stableStringifyJson cannot serialize a top-level undefined, function, or symbol value',
    )
  }
  return serialized
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
  // Steps 1-2: invoke toJSON(key), then unbox primitive wrappers.
  value = prepareJsonValue(value, key)

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

function stringifyStable(
  value: unknown,
  ancestors: WeakSet<object>,
  key: string,
): string | undefined {
  value = prepareJsonValue(value, key)

  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'bigint':
      // Match native JSON.stringify's failure mode.
      JSON.stringify(value)
      return undefined
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }

  if (ancestors.has(value as object)) {
    throw new TypeError('Converting circular structure to JSON')
  }
  ancestors.add(value as object)
  try {
    if (Array.isArray(value)) {
      let out = '['
      for (let i = 0; i < value.length; i++) {
        if (i > 0) out += ','
        out += stringifyStable(value[i], ancestors, String(i)) ?? 'null'
      }
      return `${out}]`
    }

    let out = '{'
    let first = true
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const serialized = stringifyStable(
        (value as Record<string, unknown>)[k],
        ancestors,
        k,
      )
      if (serialized !== undefined) {
        if (!first) out += ','
        first = false
        out += `${JSON.stringify(k)}:${serialized}`
      }
    }
    return `${out}}`
  } finally {
    ancestors.delete(value as object)
  }
}

function prepareJsonValue(value: unknown, key: string): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    value = (value as { toJSON: (k: string) => unknown }).toJSON(key)
  }

  if (value instanceof Number) return Number(value)
  if (value instanceof String) return String(value)
  if (value instanceof Boolean) return Boolean(value.valueOf())

  return value
}
