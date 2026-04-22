export type CustomHeaders = Record<string, string>

const CUSTOM_AUTH_HEADER_NAMES = new Set([
  'authorization',
  'api-key',
  'x-api-key',
  'proxy-authorization',
])

export function sanitizeCustomHeaders(
  headers: Record<string, unknown> | null | undefined,
): CustomHeaders | undefined {
  if (!headers) {
    return undefined
  }

  const sanitizedEntries = Object.entries(headers)
    .map(([name, value]) => [
      name.trim(),
      typeof value === 'string' ? value.trim() : '',
    ] as const)
    .filter(([name, value]) => name.length > 0 && value.length > 0)

  if (sanitizedEntries.length === 0) {
    return undefined
  }

  return Object.fromEntries(sanitizedEntries)
}

export function parseCustomHeadersEnv(
  value: string | undefined,
): CustomHeaders {
  if (!value?.trim()) {
    return {}
  }

  const headers: CustomHeaders = {}
  const headerStrings = value.split(/(?:\r?\n|;)+/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue

    const name = headerString.slice(0, colonIdx).trim()
    const headerValue = headerString.slice(colonIdx + 1).trim()
    if (name && headerValue) {
      headers[name] = headerValue
    }
  }

  return headers
}

export function formatCustomHeadersEnv(
  headers: Record<string, unknown> | null | undefined,
): string | undefined {
  const sanitized = sanitizeCustomHeaders(headers)
  if (!sanitized) {
    return undefined
  }

  return Object.entries(sanitized)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

export function formatCustomHeadersInput(
  headers: Record<string, unknown> | null | undefined,
): string {
  const sanitized = sanitizeCustomHeaders(headers)
  if (!sanitized) {
    return ''
  }

  return Object.entries(sanitized)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ')
}

export function hasCustomAuthHeader(
  headers: Record<string, unknown> | null | undefined,
): boolean {
  const sanitized = sanitizeCustomHeaders(headers)
  if (!sanitized) {
    return false
  }

  return Object.entries(sanitized).some(([name]) =>
    CUSTOM_AUTH_HEADER_NAMES.has(name.trim().toLowerCase()),
  )
}
