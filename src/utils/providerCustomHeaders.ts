const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

const RESERVED_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'x-app',
  'x-client-app',
])

function isReservedHeaderName(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    RESERVED_HEADER_NAMES.has(normalized) ||
    normalized.startsWith('x-anthropic-') ||
    normalized.startsWith('anthropic-') ||
    normalized.startsWith('x-claude-')
  )
}

function parseHeaderEntries(input: string): string[] {
  return input
    .split(/[\n\r;]+/)
    .map(entry => entry.trim())
    .filter(Boolean)
}

export function serializeProfileCustomHeaders(
  headers: Record<string, string> | undefined,
): string | undefined {
  const entries = Object.entries(headers ?? {}).filter(
    ([name, value]) => name.trim() && value.trim(),
  )
  if (entries.length === 0) {
    return undefined
  }
  return entries.map(([name, value]) => `${name.trim()}: ${value.trim()}`).join('\n')
}

export function parseProfileCustomHeadersInput(input: string): {
  headers: Record<string, string>
  error?: string
} {
  const headers: Record<string, string> = {}

  for (const entry of parseHeaderEntries(input)) {
    const colonIndex = entry.indexOf(':')
    if (colonIndex <= 0) {
      return {
        headers: {},
        error: `Custom header "${entry}" must use Name: value format.`,
      }
    }

    const name = entry.slice(0, colonIndex).trim()
    const value = entry.slice(colonIndex + 1).trim()
    if (!HEADER_NAME_RE.test(name)) {
      return {
        headers: {},
        error: `Custom header "${name}" is not a valid HTTP header name.`,
      }
    }
    if (isReservedHeaderName(name)) {
      return {
        headers: {},
        error: `Custom header "${name}" is managed by OpenClaude and cannot be set on a provider profile.`,
      }
    }
    if (!value) {
      continue
    }

    headers[name] = value
  }

  return { headers }
}

export function sanitizeProfileCustomHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const serialized = serializeProfileCustomHeaders(headers)
  if (!serialized) {
    return undefined
  }
  const parsed = parseProfileCustomHeadersInput(serialized)
  if (parsed.error || Object.keys(parsed.headers).length === 0) {
    return undefined
  }
  return parsed.headers
}

export function parseCustomHeadersEnv(
  value: string | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined
  }
  const parsed = parseProfileCustomHeadersInput(value)
  return parsed.error || Object.keys(parsed.headers).length === 0
    ? undefined
    : parsed.headers
}
