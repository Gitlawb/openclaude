const STRING_ARGUMENT_TOOL_FIELDS: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  Glob: 'pattern',
  Grep: 'pattern',
}

function isBlankString(value: string): boolean {
  return value.trim().length === 0
}

function isLikelyStructuredObjectLiteral(value: string): boolean {
  // Match object-like patterns with key-value syntax:
  // {"key":, {key:, {'key':, { "key" :, etc.
  // But NOT bash compound commands like { pwd; } or { echo hi; }
  return /^\s*\{\s*['"]?\w+['"]?\s*:/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPlainStringToolArgumentField(toolName: string): string | null {
  // Guard with Object.hasOwn: `toolName` is a provider-supplied tool-call name,
  // so a plain `STRING_ARGUMENT_TOOL_FIELDS[toolName]` lookup resolves inherited
  // Object.prototype members (`constructor`, `toString`, `valueOf`, …) to their
  // functions — truthy, so the `?? null` fallback never fires and the value is
  // wrapped into a garbage-keyed object downstream.
  return Object.hasOwn(STRING_ARGUMENT_TOOL_FIELDS, toolName)
    ? STRING_ARGUMENT_TOOL_FIELDS[toolName]!
    : null
}

export function hasToolFieldMapping(toolName: string): boolean {
  // `toolName in obj` would leak proto-chain keys (see above); own-key only.
  return Object.hasOwn(STRING_ARGUMENT_TOOL_FIELDS, toolName)
}

function wrapPlainStringToolArguments(
  toolName: string,
  value: string,
): Record<string, string> | null {
  const field = getPlainStringToolArgumentField(toolName)
  if (!field) return null
  return { [field]: value }
}

export function normalizeToolArguments(
  toolName: string,
  rawArguments: string | undefined,
): unknown {
  if (rawArguments === undefined) return {}

  try {
    const parsed = JSON.parse(rawArguments)
    if (isRecord(parsed)) {
      return parsed
    }
    // Parsed as a non-object JSON value (string, number, boolean, null, array)
    if (typeof parsed === 'string' && !isBlankString(parsed)) {
      return wrapPlainStringToolArguments(toolName, parsed) ?? parsed
    }
    // For blank strings, booleans, null, arrays — pass through as-is
    // and let Zod schema validation produce a meaningful error
    return parsed
  } catch {
    // rawArguments is not valid JSON — treat as a plain string
    if (isBlankString(rawArguments) || isLikelyStructuredObjectLiteral(rawArguments)) {
      // Blank or looks like a malformed object literal — don't wrap into
      // a tool field to avoid turning garbage into executable input
      return {}
    }
    return wrapPlainStringToolArguments(toolName, rawArguments) ?? {}
  }
}
