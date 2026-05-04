export type OpenAICompatibilityFailureCategory =
  | 'connection_refused'
  | 'localhost_resolution_failed'
  | 'request_timeout'
  | 'network_error'
  | 'auth_invalid'
  | 'rate_limited'
  | 'model_not_found'
  | 'endpoint_not_found'
  | 'context_overflow'
  | 'tool_call_incompatible'
  | 'malformed_provider_response'
  | 'provider_unavailable'
  | 'unknown'

export type OpenAICompatibilityFailure = {
  source: 'network' | 'http'
  category: OpenAICompatibilityFailureCategory
  retryable: boolean
  message: string
  hint?: string
  code?: string
  status?: number
  requestUrl?: string
}

const OPENAI_CATEGORY_MARKER_PREFIX = '[openai_category='

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

const OPENAI_COMPATIBILITY_FAILURE_CATEGORIES: ReadonlySet<OpenAICompatibilityFailureCategory> =
  new Set<OpenAICompatibilityFailureCategory>([
    'connection_refused',
    'localhost_resolution_failed',
    'request_timeout',
    'network_error',
    'auth_invalid',
    'rate_limited',
    'model_not_found',
    'endpoint_not_found',
    'context_overflow',
    'tool_call_incompatible',
    'malformed_provider_response',
    'provider_unavailable',
    'unknown',
  ])

function isOpenAICompatibilityFailureCategory(
  value: string,
): value is OpenAICompatibilityFailureCategory {
  return OPENAI_COMPATIBILITY_FAILURE_CATEGORIES.has(
    value as OpenAICompatibilityFailureCategory,
  )
}

function getErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  const maxDepth = 5

  for (let depth = 0; depth < maxDepth; depth++) {
    if (
      current &&
      typeof current === 'object' &&
      'code' in current &&
      typeof (current as { code?: unknown }).code === 'string'
    ) {
      return (current as { code: string }).code
    }

    if (
      current &&
      typeof current === 'object' &&
      'cause' in current &&
      (current as { cause?: unknown }).cause !== current
    ) {
      current = (current as { cause?: unknown }).cause
      continue
    }

    break
  }

  return undefined
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLocalhostLikeHostname(hostname: string | null): boolean {
  if (!hostname) return false
  if (LOCALHOST_HOSTNAMES.has(hostname)) return true
  return /^127\./.test(hostname)
}

export function isLocalhostLikeHost(host: string | null | undefined): boolean {
  if (!host) return false
  return isLocalhostLikeHostname(host.toLowerCase())
}

function isContextOverflowMessage(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('too many tokens') ||
    lower.includes('request too large') ||
    lower.includes('context length') ||
    lower.includes('maximum context') ||
    lower.includes('input length') ||
    lower.includes('payload too large') ||
    lower.includes('prompt is too long')
  )
}

function isToolCompatibilityMessage(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('tool_calls') ||
    lower.includes('tool_call') ||
    lower.includes('tool_use') ||
    lower.includes('tool_result') ||
    lower.includes('function calling') ||
    lower.includes('function call')
  )
}

function isMalformedProviderResponse(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('invalid json') ||
    lower.includes('malformed') ||
    lower.includes('unexpected token') ||
    lower.includes('cannot parse') ||
    lower.includes('not valid json')
  )
}

function isModelNotFoundMessage(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('model') &&
    (
      lower.includes('not found') ||
      lower.includes('does not exist') ||
      lower.includes('unknown model') ||
      lower.includes('unavailable model')
    )
  )
}

export function formatOpenAICategoryMarker(
  category: OpenAICompatibilityFailureCategory,
  host?: string,
): string {
  if (host && /^[A-Za-z0-9.\-:]+$/.test(host)) {
    return `${OPENAI_CATEGORY_MARKER_PREFIX}${category},host=${host}]`
  }
  return `${OPENAI_CATEGORY_MARKER_PREFIX}${category}]`
}

export function extractOpenAICategoryMarker(
  message: string,
): OpenAICompatibilityFailureCategory | undefined {
  const match = message.match(/\[openai_category=([a-z_]+)(?:,host=[^\]]+)?]/)
  const category = match?.[1]

  if (!category || !isOpenAICompatibilityFailureCategory(category)) {
    return undefined
  }

  return category
}

export function extractOpenAICategoryHost(message: string): string | undefined {
  const match = message.match(/\[openai_category=[a-z_]+,host=([A-Za-z0-9.\-:]+)]/)
  return match?.[1]
}

export function buildOpenAICompatibilityErrorMessage(
  baseMessage: string,
  failure: Pick<OpenAICompatibilityFailure, 'category' | 'hint' | 'requestUrl'>,
): string {
  const host = failure.requestUrl ? getHostname(failure.requestUrl) ?? undefined : undefined
  const marker = formatOpenAICategoryMarker(failure.category, host)
  const hint = failure.hint ? ` Hint: ${failure.hint}` : ''
  return `${baseMessage} ${marker}${hint}`
}

export function classifyOpenAINetworkFailure(
  error: unknown,
  options: { url: string },
): OpenAICompatibilityFailure {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()
  const code = getErrorCode(error)
  const hostname = getHostname(options.url)
  const isLocalHost = isLocalhostLikeHostname(hostname)

  if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('aborterror')
  ) {
    return {
      source: 'network',
      category: 'request_timeout',
      retryable: true,
      message,
      code,
      hint: 'The provider took too long to respond. Check local model load time or increase API timeout.',
    }
  }

  if (
    isLocalHost &&
    (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      lowerMessage.includes('getaddrinfo') ||
      (code === undefined && lowerMessage.includes('fetch failed'))
    )
  ) {
    return {
      source: 'network',
      category: 'localhost_resolution_failed',
      retryable: true,
      message,
      code,
      hint: 'Localhost failed for this request. Retry with 127.0.0.1 and confirm Ollama is serving on the configured port.',
    }
  }

  if (code === 'ECONNREFUSED') {
    return {
      source: 'network',
      category: 'connection_refused',
      retryable: true,
      message,
      code,
      hint: isLocalHost
        ? 'Connection to the local provider was refused. Ensure the local server is running and listening on the configured port.'
        : 'Connection was refused by the provider endpoint. Ensure the server is running and the port is correct.',
    }
  }

  return {
    source: 'network',
    category: 'network_error',
    retryable: true,
    message,
    code,
    hint: 'Network transport failed before a provider response was received.',
  }
}

export function classifyOpenAIHttpFailure(options: {
  status: number
  body: string
  url?: string
}): OpenAICompatibilityFailure {
  const body = options.body ?? ''
  const hostname = options.url ? getHostname(options.url) : null
  const isLocalHost = isLocalhostLikeHostname(hostname)

  if (options.status === 401 || options.status === 403) {
    return {
      source: 'http',
      category: 'auth_invalid',
      retryable: false,
      status: options.status,
      message: body,
      hint: 'Authentication failed. Verify API key, token source, and endpoint-specific auth headers.',
    }
  }

  if (options.status === 429) {
    return {
      source: 'http',
      category: 'rate_limited',
      retryable: true,
      status: options.status,
      message: body,
      hint: 'Provider rate-limited the request. Retry after backoff.',
    }
  }

  if (options.status === 404 && isModelNotFoundMessage(body)) {
    return {
      source: 'http',
      category: 'model_not_found',
      retryable: false,
      status: options.status,
      message: body,
      hint: 'The selected model is not installed or not available on this endpoint.',
    }
  }

  if (options.status === 404) {
    const isRemote = hostname !== null && !isLocalHost
    return {
      source: 'http',
      category: 'endpoint_not_found',
      retryable: false,
      status: options.status,
      message: body,
      requestUrl: options.url,
      hint: isRemote
        ? `Endpoint at ${hostname} returned 404. Verify OPENAI_BASE_URL is correct and the requested model is supported by this provider.`
        : 'Endpoint was not found. Confirm OPENAI_BASE_URL includes /v1 for OpenAI-compatible local providers.',
    }
  }

  if (
    options.status === 413 ||
    ((options.status === 400 || options.status >= 500) &&
      isContextOverflowMessage(body))
  ) {
    return {
      source: 'http',
      category: 'context_overflow',
      retryable: false,
      status: options.status,
      message: body,
      hint: 'Prompt context exceeded model/server limits. Reduce context or increase provider context length.',
    }
  }

  if (options.status === 400 && isToolCompatibilityMessage(body)) {
    return {
      source: 'http',
      category: 'tool_call_incompatible',
      retryable: false,
      status: options.status,
      message: body,
      hint: 'Provider/model rejected tool-calling payload. Retry without tools or use a tool-capable model.',
    }
  }

  if (options.status >= 400 && isMalformedProviderResponse(body)) {
    return {
      source: 'http',
      category: 'malformed_provider_response',
      retryable: false,
      status: options.status,
      message: body,
      hint: 'Provider returned malformed or non-JSON response where JSON was expected.',
    }
  }

  if (options.status >= 500) {
    return {
      source: 'http',
      category: 'provider_unavailable',
      retryable: true,
      status: options.status,
      message: body,
      hint: 'Provider reported a server-side failure. Retry after a short delay.',
    }
  }

  return {
    source: 'http',
    category: 'unknown',
    retryable: false,
    status: options.status,
    message: body,
  }
}
