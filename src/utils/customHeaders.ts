export type CustomHeaders = Record<string, string>

const CUSTOM_AUTH_HEADER_NAMES = new Set([
  'authorization',
  'api-key',
  'x-api-key',
  'proxy-authorization',
])

const BLOCKED_CUSTOM_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'content-type',
])

const EMITTED_CUSTOM_HEADER_WARNINGS = new Set<string>()

type ParseCustomHeadersOptions = {
  allowSemicolonDelimiter?: boolean
  semicolonDelimiterMode?: 'always' | 'name_value_pair'
  allowQuotedValues?: boolean
}

type ParseCustomHeadersEnvOptions = ParseCustomHeadersOptions & {
  onWarning?: (warning: string) => void
  sourceName?: string
}

type ParsedCustomHeadersInput = {
  headers: CustomHeaders
  errors: string[]
}

const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

function isBlockedCustomHeaderName(name: string): boolean {
  return BLOCKED_CUSTOM_HEADER_NAMES.has(name.trim().toLowerCase())
}

function sanitizeHeaderEntries(
  headers: Record<string, unknown>,
): Array<readonly [string, string]> {
  return Object.entries(headers)
    .map(([name, value]) => [
      name.trim(),
      typeof value === 'string' ? value.trim() : '',
    ] as const)
    .filter(([name, value]) =>
      name.length > 0 &&
      value.length > 0 &&
      !isBlockedCustomHeaderName(name),
    )
}

function splitCustomHeaderEntries(
  value: string,
  options: ParseCustomHeadersOptions,
): string[] {
  if (!options.allowSemicolonDelimiter) {
    return value.split(/\r?\n+/)
  }

  const entries: string[] = []
  let current = ''
  let inQuotes = false
  let isEscaped = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (char === '\r' && !inQuotes) {
      if (current.trim()) {
        entries.push(current)
      }
      current = ''
      continue
    }

    if (char === '\n' && !inQuotes) {
      if (current.trim()) {
        entries.push(current)
      }
      current = ''
      continue
    }

    if (char === '"' && !isEscaped) {
      inQuotes = !inQuotes
      current += char
      continue
    }

    if (
      char === ';' &&
      !inQuotes &&
      (
        options.semicolonDelimiterMode === 'always' ||
        (
          options.semicolonDelimiterMode === 'name_value_pair' &&
          isLikelySemicolonHeaderDelimiter(value, index, options)
        )
      )
    ) {
      if (current.trim()) {
        entries.push(current)
      }
      current = ''
      isEscaped = false
      continue
    }

    current += char
    isEscaped = char === '\\' && !isEscaped
  }

  if (current.trim()) {
    entries.push(current)
  }

  return entries
}

function isLikelySemicolonHeaderDelimiter(
  value: string,
  semicolonIndex: number,
  _options: ParseCustomHeadersOptions,
): boolean {
  let cursor = semicolonIndex + 1
  while (cursor < value.length && (value[cursor] === ' ' || value[cursor] === '\t')) {
    cursor += 1
  }

  if (cursor >= value.length) {
    return false
  }

  let headerName = ''
  while (cursor < value.length) {
    const char = value[cursor]!
    if (char === ':') {
      if (!(headerName.length > 0 && HEADER_NAME_TOKEN.test(headerName))) {
        return false
      }

      const nextChar = value[cursor + 1]
      return nextChar === ' ' || nextChar === '\t'
    }
    if (
      char === ';' ||
      char === '\r' ||
      char === '\n' ||
      char === '"' ||
      char === ' ' ||
      char === '\t'
    ) {
      return false
    }

    headerName += char
    cursor += 1
  }

  return false
}

function parseCustomHeaderValue(
  rawHeaderValue: string,
  options: ParseCustomHeadersOptions,
): { value?: string; error?: 'required' | 'invalid_quoted' } {
  if (!rawHeaderValue) {
    return { error: 'required' }
  }

  if (!options.allowQuotedValues || !rawHeaderValue.startsWith('"')) {
    return { value: rawHeaderValue }
  }

  try {
    const parsedValue = JSON.parse(rawHeaderValue) as unknown
    if (typeof parsedValue !== 'string' || parsedValue.length === 0) {
      return { error: 'required' }
    }

    return { value: parsedValue }
  } catch {
    return { error: 'invalid_quoted' }
  }
}

function formatCustomHeaderValue(value: string): string {
  return /[;"\r\n\\]/.test(value) ? JSON.stringify(value) : value
}

function emitCustomHeaderWarning(
  options: ParseCustomHeadersEnvOptions,
  warning: string,
): void {
  if (!options.onWarning) {
    return
  }

  const warningKey = `${options.sourceName ?? 'custom headers'}:${warning}`
  if (EMITTED_CUSTOM_HEADER_WARNINGS.has(warningKey)) {
    return
  }

  EMITTED_CUSTOM_HEADER_WARNINGS.add(warningKey)
  options.onWarning(warning)
}

export function sanitizeCustomHeaders(
  headers: Record<string, unknown> | null | undefined,
): CustomHeaders | undefined {
  if (!headers) {
    return undefined
  }

  const sanitizedEntries = sanitizeHeaderEntries(headers)

  if (sanitizedEntries.length === 0) {
    return undefined
  }

  return Object.fromEntries(sanitizedEntries)
}

export function findBlockedCustomHeaderNames(
  headers: Record<string, unknown> | null | undefined,
): string[] {
  if (!headers) {
    return []
  }

  const blocked = new Map<string, string>()
  for (const [rawName] of Object.entries(headers)) {
    const name = rawName.trim()
    if (!name || !isBlockedCustomHeaderName(name)) {
      continue
    }

    const normalized = name.toLowerCase()
    if (!blocked.has(normalized)) {
      blocked.set(normalized, name)
    }
  }

  return [...blocked.values()]
}

export function parseCustomHeadersEnv(
  value: string | undefined,
  options: ParseCustomHeadersEnvOptions = {},
): CustomHeaders {
  if (!value?.trim()) {
    return {}
  }

  const headers: Record<string, string> = {}
  const headerStrings = splitCustomHeaderEntries(value, options)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    const trimmedHeaderString = headerString.trim()
    const colonIdx = trimmedHeaderString.indexOf(':')
    if (colonIdx === -1) {
      emitCustomHeaderWarning(
        options,
        `Ignoring malformed ${options.sourceName ?? 'custom headers'} entry "${trimmedHeaderString}". Use "Name: value".`,
      )
      continue
    }

    const name = trimmedHeaderString.slice(0, colonIdx).trim()
    const rawHeaderValue = trimmedHeaderString.slice(colonIdx + 1).trim()
    if (!name) {
      emitCustomHeaderWarning(
        options,
        `Ignoring malformed ${options.sourceName ?? 'custom headers'} entry "${trimmedHeaderString}". Header name is required.`,
      )
      continue
    }
    const parsedHeaderValue = parseCustomHeaderValue(rawHeaderValue, options)
    if (parsedHeaderValue.error === 'required') {
      emitCustomHeaderWarning(
        options,
        `Ignoring malformed ${options.sourceName ?? 'custom headers'} entry "${trimmedHeaderString}". Header value is required.`,
      )
      continue
    }
    if (parsedHeaderValue.error === 'invalid_quoted') {
      emitCustomHeaderWarning(
        options,
        `Ignoring malformed ${options.sourceName ?? 'custom headers'} entry "${trimmedHeaderString}". Quoted values must use valid JSON string escaping.`,
      )
      continue
    }

    headers[name] = parsedHeaderValue.value!
  }

  const blockedNames = findBlockedCustomHeaderNames(headers)
  if (blockedNames.length > 0) {
    emitCustomHeaderWarning(
      options,
      `Ignoring blocked ${options.sourceName ?? 'custom headers'} names: ${blockedNames.join(', ')}.`,
    )
  }

  return sanitizeCustomHeaders(headers) ?? {}
}

export function parseOpenAICompatibleCustomHeadersEnv(
  value: string | undefined,
  options: ParseCustomHeadersEnvOptions = {},
): CustomHeaders {
  return parseCustomHeadersEnv(value, {
    ...options,
    allowSemicolonDelimiter: true,
    semicolonDelimiterMode: 'name_value_pair',
    allowQuotedValues: true,
  })
}

export function parseCustomHeadersInput(
  value: string | undefined,
): ParsedCustomHeadersInput {
  if (!value?.trim()) {
    return {
      headers: {},
      errors: [],
    }
  }

  const rawHeaders: Record<string, string> = {}
  const errors: string[] = []

  for (const headerString of splitCustomHeaderEntries(value, {
    allowSemicolonDelimiter: true,
    semicolonDelimiterMode: 'always',
  })) {
    const trimmed = headerString.trim()
    if (!trimmed) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) {
      errors.push(
        `Malformed header entry "${trimmed}". Use "Name: value".`,
      )
      continue
    }

    const name = trimmed.slice(0, colonIdx).trim()
    const rawHeaderValue = trimmed.slice(colonIdx + 1).trim()
    if (!name) {
      errors.push(`Malformed header entry "${trimmed}". Header name is required.`)
      continue
    }
    const parsedHeaderValue = parseCustomHeaderValue(rawHeaderValue, {
      allowQuotedValues: true,
    })
    if (parsedHeaderValue.error === 'required') {
      errors.push(`Malformed header entry "${trimmed}". Header value is required.`)
      continue
    }
    if (parsedHeaderValue.error === 'invalid_quoted') {
      errors.push(
        `Malformed header entry "${trimmed}". Quoted values must use valid JSON string escaping.`,
      )
      continue
    }

    rawHeaders[name] = parsedHeaderValue.value!
  }

  const blockedNames = findBlockedCustomHeaderNames(rawHeaders)
  if (blockedNames.length > 0) {
    errors.push(
      `Blocked header names are not allowed: ${blockedNames.join(', ')}.`,
    )
  }

  return {
    headers: sanitizeCustomHeaders(rawHeaders) ?? {},
    errors,
  }
}

export function formatCustomHeadersEnv(
  headers: Record<string, unknown> | null | undefined,
): string | undefined {
  const sanitized = sanitizeCustomHeaders(headers)
  if (!sanitized) {
    return undefined
  }

  return Object.entries(sanitized)
    .map(([name, value]) => `${name}: ${formatCustomHeaderValue(value)}`)
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
    .map(([name, value]) => `${name}: ${formatCustomHeaderValue(value)}`)
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

export function redactHeadersForDisplay(
  headers: Record<string, unknown> | null | undefined,
): CustomHeaders | undefined {
  const sanitized = sanitizeCustomHeaders(headers)
  if (!sanitized) {
    return undefined
  }

  return Object.fromEntries(
    Object.keys(sanitized).map(name => [name, '***REDACTED***']),
  )
}
