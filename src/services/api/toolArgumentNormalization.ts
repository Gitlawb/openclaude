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
  return STRING_ARGUMENT_TOOL_FIELDS[toolName] ?? null
}

export function hasToolFieldMapping(toolName: string): boolean {
  return toolName in STRING_ARGUMENT_TOOL_FIELDS
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

  // Strip markdown code block wrapping if the LLM hallucinated it inside the tool call string
  const cleanArguments = typeof rawArguments === 'string' 
    ? rawArguments.replace(/^\s*```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim() 
    : rawArguments

  try {
    const parsed = JSON.parse(cleanArguments)
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
    // Attempt naive newline unescaping if JSON.parse failed 
    // (Gemini occasionally sends unescaped literal newlines inside strings)
    if (typeof cleanArguments === 'string' && cleanArguments.includes('\n')) {
      try {
        let inString = false
        let isEscaped = false
        let repaired = ''
        for (let i = 0; i < cleanArguments.length; i++) {
          const char = cleanArguments[i]
          if (inString) {
            if (char === '\\' && !isEscaped) {
              isEscaped = true
              repaired += char
            } else if (char === '"' && !isEscaped) {
              inString = false
              repaired += char
            } else if (char === '\n') {
              repaired += '\\n'
              isEscaped = false
            } else if (char === '\r') {
              repaired += '\\r'
              isEscaped = false
            } else if (char === '\t') {
              repaired += '\\t'
              isEscaped = false
            } else {
              repaired += char
              isEscaped = false
            }
          } else {
            if (char === '"') {
              inString = true
            }
            repaired += char
          }
        }
        const repairedParsed = JSON.parse(repaired)
        if (isRecord(repairedParsed)) {
          return repairedParsed
        }
      } catch (e) {
        // Fall through to original error handling
      }
    }

    // rawArguments is not valid JSON — treat as a plain string
    if (isBlankString(cleanArguments) || isLikelyStructuredObjectLiteral(cleanArguments)) {
      // Blank or looks like a malformed object literal — don't wrap into
      // a tool field to avoid turning garbage into executable input
      return {}
    }
    return wrapPlainStringToolArguments(toolName, cleanArguments) ?? {}
  }
}
