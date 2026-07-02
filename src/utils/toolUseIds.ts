/**
 * Maximum tool-call id length accepted by the OpenAI Responses API. The
 * chat/completions path may use a smaller endpoint-specific limit.
 */
export const MAX_WIRE_TOOL_ID_LENGTH = 64

/**
 * Sanitize a persisted tool_use id for an outgoing provider wire.
 *
 * Some providers can round-trip metadata in ids that other OpenAI-compatible
 * wires reject because of length or charset constraints. Keep the stable
 * alphanumeric prefix, then cap deterministically with a hash tail so distinct
 * overlong ids stay distinct.
 */
export function sanitizeToolUseIdForWire(
  value: unknown,
  maxLength = MAX_WIRE_TOOL_ID_LENGTH,
): string {
  const str = typeof value === 'string' ? value : value == null ? '' : String(value)
  const clean = str.replace(/[^A-Za-z0-9_-][\s\S]*$/, '')
  if (clean.length > 0 && clean.length <= maxLength) {
    return clean
  }

  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  const tail = `_${hash.toString(36)}`
  if (clean.length === 0) {
    return `tool${tail}`
  }
  const prefixLength = Math.max(1, maxLength - tail.length)
  return clean.slice(0, prefixLength) + tail
}
