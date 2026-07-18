import type { CredentialLease, CredentialPool } from '../credentialPool.js'
import type { OpenAICompatibilityFailure } from '../openaiErrorClassification.js'
import type { OpenAIShimRuntimeContext } from '../../../integrations/runtimeMetadata.js'

export function formatRetryAfterHint(response: Response): string {
  const retryAfter = response.headers.get('retry-after')
  return retryAfter ? ` (Retry-After: ${retryAfter})` : ''
}

export function sleepMs(
  ms: number,
  schedule: (callback: () => void, delay: number) => unknown = setTimeout,
): Promise<void> {
  return new Promise((resolve) => schedule(resolve, ms))
}

type CompatibilityFailure = Pick<
  OpenAICompatibilityFailure,
  'category' | 'hint' | 'requestUrl'
>

type ClassifiedFailure = OpenAICompatibilityFailure

type GeminiCredential = {
  kind: string
  credential?: string
  projectId?: string
}

type RequestExecutorContext = {
  defaultHeaders: Record<string, string>
  providerOverride?: { apiKey?: string }
  getCredentialPool: (rawCredentials: string) => CredentialPool | null
  filterAnthropicHeaders: (
    headers?: Record<string, string>,
  ) => Record<string, string>
  isGeminiMode: () => boolean
  resolveRouteCredentialValue: (input: {
    routeId?: string
    baseUrl: string
    processEnv: NodeJS.ProcessEnv
  }) => string | undefined
  isXaiBaseUrl: (baseUrl: string) => boolean
  parseCredentialList: (value?: string) => string[]
  resolveXaiAccessToken: () => Promise<string | undefined>
  hasInvalidCredentialPlaceholder: (value: string) => boolean
  buildOpenAICompatibilityErrorMessage: (
    message: string,
    failure: CompatibilityFailure,
  ) => string
  isAzureStyleBaseUrl: (
    baseUrl: string,
    processEnv: NodeJS.ProcessEnv,
  ) => boolean
  resolveGeminiCredential: (
    processEnv: NodeJS.ProcessEnv,
  ) => Promise<GeminiCredential>
  COPILOT_HEADERS: Record<string, string>
  getSessionId: () => string
  getLocalProviderRetryBaseUrls: (baseUrl: string) => string[]
  buildOllamaChatUrl: (baseUrl: string) => string
  logForDebugging: (
    message: string,
    options?: { level: 'warn' | 'error' | 'info' | 'debug' },
  ) => void
  redactUrlForDiagnostics: (url: string) => string
  redactSecretValueForDisplay: (
    value: string,
    source: NodeJS.ProcessEnv,
  ) => string | undefined
  headersWithRequestUrl: (headers: Headers, requestUrl: string) => Headers
  classifyOpenAINetworkFailure: (
    error: unknown,
    context: { url: string },
  ) => ClassifiedFailure
  classifyOpenAIHttpFailure: (context: {
    status: number
    body: string
    url?: string
    hasImages: boolean
  }) => ClassifiedFailure
  fetchWithProxyRetry: (input: string, init: RequestInit) => Promise<Response>
  formatRetryAfterHint: (response: Response) => string
  redactUrlsInMessage: (message: string) => string
  sleepMs: (ms: number) => Promise<void>
  shouldAttemptLocalToollessRetry: (input: {
    baseUrl: string
    hasTools: boolean
  }) => boolean
  refreshCopilotTokenOn401: () => Promise<boolean>
  isCopilotTokenExpiredError: (text: string) => boolean
  convertOllamaStreamingResponse: (
    response: Response,
    model: string,
  ) => Response
  convertOllamaNonStreamingResponse: (
    response: Response,
    model: string,
  ) => Promise<Response>
  logApiCallStart: (
    provider: string,
    model: string,
  ) => { correlationId: string; startTime: number }
  logApiCallEnd: (
    correlationId: string,
    startTime: number,
    model: string,
    status: 'success' | 'error',
    tokensIn: number,
    tokensOut: number,
    cached: boolean,
  ) => void
  stableStringifyJson: (value: unknown) => string
  APIError: {
    generate: (
      status: number | undefined,
      error: object | undefined,
      message: string,
      headers: Headers,
    ) => Error
  }
  GITHUB_429_MAX_RETRIES: number
  GITHUB_429_BASE_DELAY_SEC: number
  GITHUB_429_MAX_DELAY_SEC: number
  request: {
    baseUrl: string
    resolvedModel: string
    transport: string
  }
  params: { stream?: boolean; tools?: unknown[] }
  options?: { headers?: Record<string, string>; signal?: AbortSignal }
  requestProcessEnv: NodeJS.ProcessEnv
  fastPath: { skipStableStringify: boolean }
  shimConfig: {
    headers?: Record<string, string>
    endpointPath?: string
    defaultAuthHeader?: { name: string; scheme?: string }
  }
  runtimeShimContext: OpenAIShimRuntimeContext
  body: Record<string, unknown>
  effectiveTransport: string
  useNativeOllamaChat: boolean
  buildResponsesBody: () => Record<string, unknown>
  serializeBody: () => string
  omitTools: {
    responses: boolean
    anthropic: boolean
    gemini: boolean
  }
  isLocal: boolean
  isGithub: boolean
  isGithubCopilot: boolean
  isGithubModels: boolean
}

export async function executeOpenAIRequest(
  context: RequestExecutorContext,
): Promise<Response> {
  const {
    defaultHeaders,
    providerOverride,
    getCredentialPool,
    filterAnthropicHeaders,
    isGeminiMode,
    resolveRouteCredentialValue,
    isXaiBaseUrl,
    parseCredentialList,
    resolveXaiAccessToken,
    hasInvalidCredentialPlaceholder,
    buildOpenAICompatibilityErrorMessage,
    isAzureStyleBaseUrl,
    resolveGeminiCredential,
    COPILOT_HEADERS,
    getSessionId,
    getLocalProviderRetryBaseUrls,
    buildOllamaChatUrl,
    logForDebugging,
    redactUrlForDiagnostics,
    redactSecretValueForDisplay,
    headersWithRequestUrl,
    classifyOpenAINetworkFailure,
    classifyOpenAIHttpFailure,
    fetchWithProxyRetry,
    formatRetryAfterHint,
    redactUrlsInMessage,
    sleepMs,
    shouldAttemptLocalToollessRetry,
    refreshCopilotTokenOn401,
    isCopilotTokenExpiredError,
    convertOllamaStreamingResponse,
    convertOllamaNonStreamingResponse,
    logApiCallStart,
    logApiCallEnd,
    stableStringifyJson,
    APIError,
    GITHUB_429_MAX_RETRIES,
    GITHUB_429_BASE_DELAY_SEC,
    GITHUB_429_MAX_DELAY_SEC,
    request,
    params,
    options,
    requestProcessEnv,
    fastPath,
    shimConfig,
    runtimeShimContext,
    body,
    effectiveTransport,
    useNativeOllamaChat,
    buildResponsesBody,
    serializeBody,
    omitTools,
    isLocal,
    isGithub,
    isGithubCopilot,
    isGithubModels,
  } = context
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...filterAnthropicHeaders(shimConfig.headers),
    ...defaultHeaders,
    ...filterAnthropicHeaders(options?.headers),
  }

  const isGemini = isGeminiMode()
  const routeCredential = resolveRouteCredentialValue({
    routeId: runtimeShimContext.routeId ?? undefined,
    baseUrl: request.baseUrl,
    processEnv: process.env,
  })
  // xAI OAuth: when the active route is xAI and no API key is set, fall
  // back to a stored OAuth access token (auto-refreshed). The token is
  // sent as a Bearer to api.x.ai/v1 — same surface as an API key.
  const isXaiRoute =
    runtimeShimContext.routeId === 'xai' || isXaiBaseUrl(request.baseUrl)
  const openAIApiKeysPoolRaw =
    parseCredentialList(process.env.OPENAI_API_KEYS).length > 0
      ? process.env.OPENAI_API_KEYS
      : undefined
  const openAIApiKeyRaw = process.env.OPENAI_API_KEY?.trim()
  const openAIApiKeyValues = parseCredentialList(openAIApiKeyRaw)
  const openAIApiKey = openAIApiKeyValues[0]
  const openAIApiKeyRawUsable =
    openAIApiKeyValues.length > 0 ? openAIApiKeyRaw : undefined
  const xaiOAuthToken =
    isXaiRoute &&
    !providerOverride?.apiKey &&
    !routeCredential &&
    !openAIApiKeysPoolRaw &&
    !openAIApiKey
      ? await resolveXaiAccessToken()
      : undefined
  const openAIApiKeyIsCopiedProviderKey = Boolean(
    openAIApiKeyRawUsable &&
    [
      process.env.OPENGATEWAY_API_KEY,
      process.env.NVIDIA_API_KEY,
      process.env.BNKR_API_KEY,
      process.env.XAI_API_KEY,
      process.env.MIMO_API_KEY,
      process.env.VENICE_API_KEY,
      process.env.MINIMAX_API_KEY,
      process.env.ATLAS_CLOUD_API_KEY,
      process.env.NEARAI_API_KEY,
      process.env.FIREWORKS_API_KEY,
    ].some((value) => value?.trim() === openAIApiKeyRawUsable),
  )
  const routeCredentialIsCopiedProviderKey = Boolean(
    routeCredential &&
    openAIApiKeyRawUsable &&
    routeCredential === openAIApiKeyRawUsable &&
    openAIApiKeyIsCopiedProviderKey,
  )
  const routeCredentialIsProviderSpecific = Boolean(
    routeCredential &&
    (!openAIApiKeyRawUsable ||
      routeCredential !== openAIApiKeyRawUsable ||
      routeCredentialIsCopiedProviderKey),
  )
  const routeCredentialIsGenericOpenAIFallback = Boolean(
    !routeCredentialIsProviderSpecific &&
    routeCredential &&
    openAIApiKeyRawUsable &&
    routeCredential === openAIApiKeyRawUsable,
  )
  const apiKeyRaw =
    providerOverride?.apiKey ??
    (openAIApiKeyIsCopiedProviderKey ? openAIApiKeyRawUsable : undefined) ??
    (routeCredentialIsGenericOpenAIFallback ? undefined : routeCredential) ??
    openAIApiKeysPoolRaw ??
    routeCredential ??
    (openAIApiKeyRawUsable || xaiOAuthToken || '')
  // A catalog-level auth header is part of the selected model's transport
  // contract. Ignore global custom auth left behind by another route so it
  // cannot replace that model-specific header or credential.
  const catalogAuthHeader =
    runtimeShimContext.catalogEntry?.transportOverrides?.openaiShim
      ?.defaultAuthHeader
  const configuredAuthHeaderValue = catalogAuthHeader
    ? undefined
    : process.env.OPENAI_AUTH_HEADER_VALUE?.trim()
  if (configuredAuthHeaderValue && /[\r\n]/.test(configuredAuthHeaderValue)) {
    throw new Error(
      'OPENAI_AUTH_HEADER_VALUE must not contain CR/LF characters',
    )
  }
  const customAuthHeader = catalogAuthHeader
    ? undefined
    : process.env.OPENAI_AUTH_HEADER?.trim()
  const hasCustomAuthHeader = Boolean(
    customAuthHeader && /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(customAuthHeader),
  )
  const explicitCustomAuthHeaderValue = hasCustomAuthHeader
    ? configuredAuthHeaderValue
    : ''
  if (
    !explicitCustomAuthHeaderValue &&
    hasInvalidCredentialPlaceholder(apiKeyRaw)
  ) {
    throw APIError.generate(
      401,
      undefined,
      buildOpenAICompatibilityErrorMessage(
        'OpenAI API error 401: invalid credential pool placeholder SUA_CHAVE detected',
        {
          category: 'auth_invalid',
          requestUrl: request.baseUrl,
        },
      ),
      new Headers(),
    )
  }
  const isAzure = isAzureStyleBaseUrl(request.baseUrl, requestProcessEnv)

  let isBankr = false
  try {
    isBankr =
      runtimeShimContext.routeId === 'bankr' ||
      request.baseUrl.toLowerCase().includes('bankr')
  } catch {
    /* malformed URL — not Bankr */
  }

  const credentialPool = explicitCustomAuthHeaderValue
    ? null
    : getCredentialPool(apiKeyRaw)
  const singleAuthValue =
    explicitCustomAuthHeaderValue ||
    parseCredentialList(apiKeyRaw)[0] ||
    apiKeyRaw

  const buildHeadersForAttempt = async (
    credentialLease: CredentialLease | null,
  ): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { ...baseHeaders }
    const authValue =
      explicitCustomAuthHeaderValue ||
      refreshedCopilotToken ||
      credentialLease?.value ||
      (credentialPool ? '' : singleAuthValue)

    if (authValue) {
      if (hasCustomAuthHeader && customAuthHeader) {
        const defaultCustomAuthScheme =
          customAuthHeader.toLowerCase() === 'authorization' ? 'bearer' : 'raw'
        const customAuthScheme =
          process.env.OPENAI_AUTH_SCHEME === 'raw' ||
          process.env.OPENAI_AUTH_SCHEME === 'bearer'
            ? process.env.OPENAI_AUTH_SCHEME
            : defaultCustomAuthScheme
        headers[customAuthHeader] =
          customAuthScheme === 'bearer' ? `Bearer ${authValue}` : authValue
      } else if (isAzure) {
        // Azure uses api-key header instead of Bearer token
        headers['api-key'] = authValue
      } else if (isBankr) {
        // Bankr uses X-API-Key header instead of Bearer token
        headers['X-API-Key'] = authValue
      } else if (shimConfig.defaultAuthHeader?.name) {
        headers[shimConfig.defaultAuthHeader.name] =
          shimConfig.defaultAuthHeader.scheme === 'bearer'
            ? `Bearer ${authValue}`
            : authValue
      } else {
        headers.Authorization = `Bearer ${authValue}`
      }
    } else if (isGemini) {
      const geminiCredential = await resolveGeminiCredential(process.env)
      if (geminiCredential.kind !== 'none' && geminiCredential.credential) {
        headers.Authorization = `Bearer ${geminiCredential.credential}`
        if (
          geminiCredential.kind !== 'api-key' &&
          'projectId' in geminiCredential &&
          geminiCredential.projectId
        ) {
          headers['x-goog-user-project'] = geminiCredential.projectId
        }
      }
    }

    if (isGithubCopilot) {
      Object.assign(headers, COPILOT_HEADERS)
    } else if (isGithubModels) {
      headers['Accept'] = 'application/vnd.github+json'
      headers['X-GitHub-Api-Version'] = '2022-11-28'
    }

    // xAI / Grok prompt caching. Pinning the session id via x-grok-conv-id
    // routes follow-up requests to the same backend so xAI can reuse the
    // cached system prompt and conversation history. Mirrors the Hermes
    // implementation (RELEASE_v0.8.0 PR #5604).
    if (isXaiRoute) {
      headers['x-grok-conv-id'] ??= getSessionId()
    }

    return headers
  }

  const buildChatCompletionsUrl = (baseUrl: string): string => {
    // Azure Cognitive Services / Azure OpenAI require a deployment-specific
    // path and an api-version query parameter.
    if (isAzure) {
      const normalizedBaseUrl = (baseUrl.split(/[?#]/, 1)[0] ?? baseUrl).replace(
        /\/+$/,
        '',
      )
      const apiVersion =
        process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview'
      const deployment = encodeURIComponent(
        request.resolvedModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o',
      )

      // If base URL already contains /deployments/, use it as-is with api-version.
      if (/\/deployments\//i.test(normalizedBaseUrl)) {
        return `${normalizedBaseUrl}/chat/completions?api-version=${apiVersion}`
      }

      // Strip trailing /v1 or /openai/v1 if present, then build Azure path.
      const normalizedBase = normalizedBaseUrl
        .replace(/\/(openai\/)?v1\/?$/, '')
        .replace(/\/+$/, '')

      return `${normalizedBase}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
    }

    return `${baseUrl}/chat/completions`
  }

  const buildResponsesUrl = (baseUrl: string): string => {
    const trimmedBase = baseUrl.replace(/\/+$/, '')
    if (!isAzure) return `${trimmedBase}/responses`

    let normalizedBase = (trimmedBase.split(/[?#]/, 1)[0] ?? trimmedBase).replace(
      /\/+$/,
      '',
    )
    for (;;) {
      const stripped = normalizedBase
        .replace(/\/(openai\/)?v1$/i, '')
        .replace(/\/openai\/deployments\/[^/]+$/i, '')
        .replace(/\/+$/, '')
      if (stripped === normalizedBase) break
      normalizedBase = stripped
    }
    return `${normalizedBase}/openai/v1/responses`
  }

  const localRetryBaseUrls = isLocal
    ? getLocalProviderRetryBaseUrls(request.baseUrl)
    : []

  const buildRequestUrl = (baseUrl: string): string => {
    if (shimConfig.endpointPath) {
      return `${baseUrl}${shimConfig.endpointPath}`
    }
    if (useNativeOllamaChat) {
      return buildOllamaChatUrl(baseUrl)
    }
    return request.transport === 'responses' ||
      request.transport === 'responses_compat'
      ? buildResponsesUrl(baseUrl)
      : buildChatCompletionsUrl(baseUrl)
  }

  let activeBaseUrl = request.baseUrl
  let requestUrl = buildRequestUrl(activeBaseUrl)
  const attemptedLocalBaseUrls = new Set<string>([activeBaseUrl])
  let didRetryWithoutTools = false
  let didRetryWithoutToolStream = false
  let retryCredentialLease: CredentialLease | null = null
  let didRefreshCopilotToken = false
  let refreshedCopilotToken: string | undefined

  const promoteNextLocalBaseUrl = (
    reason: 'endpoint_not_found' | 'localhost_resolution_failed',
  ): boolean => {
    for (const candidateBaseUrl of localRetryBaseUrls) {
      if (attemptedLocalBaseUrls.has(candidateBaseUrl)) {
        continue
      }

      const previousUrl = requestUrl
      attemptedLocalBaseUrls.add(candidateBaseUrl)
      activeBaseUrl = candidateBaseUrl
      requestUrl = buildRequestUrl(activeBaseUrl)

      logForDebugging(
        `[OpenAIShim] self-heal retry reason=${reason} method=POST from=${redactUrlForDiagnostics(previousUrl)} to=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
        { level: 'warn' },
      )

      return true
    }

    return false
  }

  const bodyContainsImages = (): boolean => {
    if (request.transport === 'responses') {
      const responsesBody = buildResponsesBody()
      const input = responsesBody.input as
        Array<Record<string, unknown>> | undefined
      if (!Array.isArray(input)) return false
      return input.some((item) => {
        const content = item.content as
          Array<Record<string, unknown>> | undefined
        return (
          Array.isArray(content) &&
          content.some((part) => part.type === 'input_image')
        )
      })
    }
    const messages = body.messages as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(messages)) return false
    return messages.some((msg) => {
      const content = msg.content
      if (!Array.isArray(content)) return false
      return content.some(
        (part: Record<string, unknown>) => part.type === 'image_url',
      )
    })
  }

  // WHY: byte-identity required for implicit prefix caching in
  // OpenAI/Kimi/DeepSeek. stableStringify sorts object keys at every
  // depth so spurious insertion-order differences across rebuilds of
  // `body` (spread-merge, conditional assignments above) don't bust
  // the provider's prefix hash.
  //
  // Local backends do not implement prefix caching, so the deep key-sort
  // is pure CPU overhead per request (issue #1016). Drop to the native
  // `JSON.stringify` fast path when the fast-path config opts out.
  let serializedBody = serializeBody()

  const refreshSerializedBody = (): void => {
    serializedBody = serializeBody()
  }

  const buildFetchInit = (headers: Record<string, string>) => ({
    method: 'POST' as const,
    headers,
    body: serializedBody,
    signal: options?.signal,
  })

  const maxSelfHealAttempts = isLocal ? localRetryBaseUrls.length + 1 : 0
  const credentialPoolAttempts = credentialPool?.size ?? 1
  let maxAttempts =
    Math.max(isGithub ? GITHUB_429_MAX_RETRIES : 1, credentialPoolAttempts) +
    maxSelfHealAttempts

  const throwClassifiedTransportError = (
    error: unknown,
    requestUrl: string,
    preclassifiedFailure?: ReturnType<typeof classifyOpenAINetworkFailure>,
  ): never => {
    if (options?.signal?.aborted) {
      throw error
    }

    const failure =
      preclassifiedFailure ??
      classifyOpenAINetworkFailure(error, {
        url: requestUrl,
      })
    const redactedUrl = redactUrlForDiagnostics(requestUrl)
    const safeMessage =
      redactSecretValueForDisplay(
        redactUrlsInMessage(failure.message),
        process.env,
      ) || 'Request failed'

    logForDebugging(
      `[OpenAIShim] transport failure category=${failure.category} retryable=${failure.retryable} code=${failure.code ?? 'unknown'} method=POST url=${redactedUrl} model=${request.resolvedModel} message=${safeMessage}`,
      { level: 'warn' },
    )

    throw APIError.generate(
      0,
      undefined,
      buildOpenAICompatibilityErrorMessage(
        `OpenAI API transport error: ${safeMessage}${failure.code ? ` (code=${failure.code})` : ''}`,
        failure,
      ),
      new Headers(),
    )
  }

  const throwClassifiedHttpError = (
    status: number,
    errorBody: string,
    parsedBody: object | undefined,
    responseHeaders: Headers,
    requestUrl: string,
    rateHint = '',
    preclassifiedFailure?: ReturnType<typeof classifyOpenAIHttpFailure>,
  ): never => {
    const failure =
      preclassifiedFailure ??
      classifyOpenAIHttpFailure({
        status,
        body: errorBody,
        url: requestUrl,
        hasImages: bodyContainsImages(),
      })
    const failureWithUrl = {
      ...failure,
      requestUrl: failure.requestUrl ?? requestUrl,
    }
    const redactedUrl = redactUrlForDiagnostics(requestUrl)

    logForDebugging(
      `[OpenAIShim] request failed category=${failure.category} retryable=${failure.retryable} status=${status} method=POST url=${redactedUrl} model=${request.resolvedModel}`,
      { level: 'warn' },
    )

    throw APIError.generate(
      status,
      parsedBody,
      buildOpenAICompatibilityErrorMessage(
        `OpenAI API error ${status}: ${errorBody}${rateHint}`,
        failureWithUrl,
      ),
      headersWithRequestUrl(responseHeaders, requestUrl),
    )
  }

  let response: Response | undefined
  const provider = request.baseUrl.includes('nvidia')
    ? 'nvidia-nim'
    : request.baseUrl.includes('minimax')
      ? 'minimax'
      : request.baseUrl.includes('xiaomimimo') ||
          request.baseUrl.includes('mimo-v2')
        ? 'xiaomi-mimo'
        : request.baseUrl.includes('localhost:11434') ||
            request.baseUrl.includes('localhost:11435')
          ? 'ollama'
          : request.baseUrl.includes('anthropic')
            ? 'anthropic'
            : 'openai'
  const { correlationId, startTime } = logApiCallStart(
    provider,
    request.resolvedModel,
  )
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const credentialLease =
      retryCredentialLease ?? credentialPool?.next() ?? null
    retryCredentialLease = null
    if (credentialPool && !credentialLease) {
      throw APIError.generate(
        401,
        undefined,
        buildOpenAICompatibilityErrorMessage(
          'OpenAI API error 401: credential pool exhausted after authentication failures',
          {
            category: 'auth_invalid',
            requestUrl,
          },
        ),
        new Headers(),
      )
    }
    const headers = await buildHeadersForAttempt(credentialLease)
    try {
      response = await fetchWithProxyRetry(requestUrl, buildFetchInit(headers))
    } catch (error) {
      const isAbortError =
        options?.signal?.aborted === true ||
        (typeof DOMException !== 'undefined' &&
          error instanceof DOMException &&
          error.name === 'AbortError') ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError')

      if (isAbortError) {
        throw error
      }

      const failure = classifyOpenAINetworkFailure(error, {
        url: requestUrl,
      })

      if (
        isLocal &&
        failure.category === 'localhost_resolution_failed' &&
        promoteNextLocalBaseUrl('localhost_resolution_failed')
      ) {
        continue
      }

      throwClassifiedTransportError(error, requestUrl, failure)
    }

    // After the try/catch, response is guaranteed to be defined — the catch
    // block always throws (throwClassifiedTransportError returns never).
    if (!response) continue

    if (response.ok) {
      credentialPool?.reportSuccess(credentialLease)
      if (useNativeOllamaChat) {
        response = params.stream
          ? convertOllamaStreamingResponse(response, request.resolvedModel)
          : await convertOllamaNonStreamingResponse(
              response,
              request.resolvedModel,
            )
      }
      let tokensIn = 0
      let tokensOut = 0
      // Skip clone() for streaming responses - it blocks until full body is received,
      // defeating the purpose of streaming. Usage data is already sent via
      // stream_options: { include_usage: true } and can be extracted from the stream.
      if (!params.stream) {
        try {
          const bodyText = await response.text()
          // Preserve routing metadata that `new Response()` drops to "".
          // create() reads `response.url` to route between /responses,
          // /messages, and Gemini conversion paths; losing it makes
          // descriptor routes (OpenCode /messages, Gemini /models/gemini-*)
          // fall through to the generic OpenAI converter and return the
          // wrong message shape. `url` is a read-only getter on the
          // prototype, so shadow it with an own property.
          const originalUrl = response.url
          const originalType = response.type
          // Recreate the response immediately after reading the body, before
          // JSON.parse — if parsing fails, downstream code can still read the
          // body from the fresh Response instead of hitting "Body already used".
          response = new Response(bodyText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
          if (originalUrl) {
            try {
              Object.defineProperty(response, 'url', {
                value: originalUrl,
                configurable: true,
              })
            } catch {
              /* some runtimes lock the property; routing falls back to transport */
            }
          }
          if (originalType && originalType !== 'basic') {
            try {
              Object.defineProperty(response, 'type', {
                value: originalType,
                configurable: true,
              })
            } catch {
              /* non-fatal: type is not used for response routing */
            }
          }
          const data = JSON.parse(bodyText)
          tokensIn = data.usage?.prompt_tokens ?? 0
          tokensOut = data.usage?.completion_tokens ?? 0
        } catch {
          /* ignore — response is already recreated with the body intact */
        }
      }
      logApiCallEnd(
        correlationId,
        startTime,
        request.resolvedModel,
        'success',
        tokensIn,
        tokensOut,
        false,
      )
      return response
    }

    if (isGithub && response.status === 429 && attempt < maxAttempts - 1) {
      await response.text().catch(() => {})
      const delaySec = Math.min(
        GITHUB_429_BASE_DELAY_SEC * 2 ** attempt,
        GITHUB_429_MAX_DELAY_SEC,
      )
      await sleepMs(delaySec * 1000)
      continue
    }
    // Read body exactly once here — Response body is a stream that can only
    // be consumed a single time.
    const errorBody = await response.text().catch(() => 'unknown error')
    const rateHint =
      isGithub && response.status === 429 ? formatRetryAfterHint(response) : ''

    // If GitHub Copilot returns error about /chat/completions,
    // try the /responses endpoint (needed for GPT-5+ models)
    if (isGithub && response.status === 400) {
      if (
        errorBody.includes('/chat/completions') ||
        errorBody.includes('not accessible')
      ) {
        const responsesUrl = `${request.baseUrl}/responses`
        const responsesBody = buildResponsesBody()

        let responsesResponse!: Response
        try {
          responsesResponse = await fetchWithProxyRetry(responsesUrl, {
            method: 'POST',
            headers,
            body: stableStringifyJson(responsesBody),
            signal: options?.signal,
          })
        } catch (error) {
          throwClassifiedTransportError(error, responsesUrl)
        }

        if (responsesResponse.ok) {
          return responsesResponse
        }
        const responsesErrorBody = await responsesResponse
          .text()
          .catch(() => 'unknown error')
        const responsesFailure = classifyOpenAIHttpFailure({
          status: responsesResponse.status,
          body: responsesErrorBody,
          hasImages: bodyContainsImages(),
        })
        let responsesErrorResponse: object | undefined
        try {
          responsesErrorResponse = JSON.parse(responsesErrorBody)
        } catch {
          /* raw text */
        }
        throwClassifiedHttpError(
          responsesResponse.status,
          responsesErrorBody,
          responsesErrorResponse,
          responsesResponse.headers,
          responsesUrl,
          '',
          responsesFailure,
        )
      }
    }

    const failure = classifyOpenAIHttpFailure({
      status: response.status,
      body: errorBody,
      hasImages: bodyContainsImages(),
    })

    // GitHub Copilot 401 with expired token: force-refresh and retry once.
    // Only applies to the Copilot endpoint, not GitHub Models API or custom
    // routes, and only when the failing credential is the stored Copilot
    // token (not a provider override, route credential, or custom auth).
    // The refreshed token is stored in refreshedCopilotToken so the next
    // iteration's buildHeadersForAttempt picks it up instead of the stale
    // singleAuthValue captured before the loop.
    if (isGithubCopilot && response.status === 401 && !didRefreshCopilotToken) {
      if (isCopilotTokenExpiredError(errorBody)) {
        const oldToken = headers.Authorization?.replace(/^Bearer\s+/i, '') || ''
        if (oldToken && oldToken === (process.env.OPENAI_API_KEY ?? '')) {
          didRefreshCopilotToken = true
          const refreshed = await refreshCopilotTokenOn401()
          if (refreshed) {
            const newApiKey = process.env.OPENAI_API_KEY?.trim() || ''
            if (newApiKey && newApiKey !== oldToken) {
              refreshedCopilotToken = newApiKey
            }
            if (attempt < maxAttempts - 1) {
              continue
            }
          }
        }
      }
    }

    const credentialFailureKind =
      failure.category === 'auth_invalid' && !failure.retryable
        ? 'auth'
        : response.status === 402 || response.status === 429
          ? 'cooldown'
          : null
    if (credentialPool && credentialPool.size > 1 && credentialFailureKind) {
      credentialPool.reportFailure(
        credentialLease,
        credentialFailureKind,
        CREDENTIAL_POOL_COOLDOWN_MS,
      )
      if (attempt < maxAttempts - 1) {
        logForDebugging(
          `[OpenAIShim] credential pool retry status=${response.status} method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
          { level: 'warn' },
        )
        continue
      }
    }

    if (
      isLocal &&
      failure.category === 'endpoint_not_found' &&
      promoteNextLocalBaseUrl('endpoint_not_found')
    ) {
      continue
    }

    const hasToolsPayload =
      effectiveTransport === 'responses' ||
      effectiveTransport === 'responses_compat' ||
      effectiveTransport === 'anthropic_messages' ||
      effectiveTransport === 'gemini'
        ? Array.isArray(params.tools) && params.tools.length > 0
        : Array.isArray(body.tools) && body.tools.length > 0

    if (
      !didRetryWithoutTools &&
      failure.category === 'tool_call_incompatible' &&
      shouldAttemptLocalToollessRetry({
        baseUrl: activeBaseUrl,
        hasTools: hasToolsPayload,
      })
    ) {
      didRetryWithoutTools = true
      delete body.tools
      delete body.tool_choice
      delete body.tool_stream
      omitTools.responses = true
      omitTools.anthropic = true
      omitTools.gemini = true
      refreshSerializedBody()

      logForDebugging(
        `[OpenAIShim] self-heal retry reason=tool_call_incompatible mode=toolless method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
        { level: 'warn' },
      )
      continue
    }

    // `tool_stream` self-heal (#1950): some OpenAI-compatible gateways (e.g.
    // NVIDIA NIM) reject the Z.AI-proprietary `tool_stream` parameter with a
    // 400. Drop only that parameter and retry with tools intact — streaming
    // tool calls simply aren't streamed on such gateways. This guards against
    // regressions where the parameter slips through the catalog/runtime
    // gating that normally suppresses it.
    if (
      !didRetryWithoutToolStream &&
      failure.category === 'tool_stream_unsupported' &&
      body.tool_stream === true
    ) {
      didRetryWithoutToolStream = true
      // Reserve one additional request only after this specific recovery is
      // needed. Increasing the shared initial budget changes unrelated
      // GitHub and credential-pool retry behavior.
      maxAttempts += 1
      delete body.tool_stream
      refreshSerializedBody()
      // This retry only changes request formatting. Reuse the credential that
      // received the rejection so a pool with unequal model access cannot
      // turn a recoverable 400 into an unrelated authorization failure.
      retryCredentialLease = credentialLease

      logForDebugging(
        `[OpenAIShim] self-heal retry reason=tool_stream_unsupported method=POST url=${redactUrlForDiagnostics(requestUrl)} model=${request.resolvedModel}`,
        { level: 'warn' },
      )
      continue
    }

    let errorResponse: object | undefined
    try {
      errorResponse = JSON.parse(errorBody)
    } catch {
      /* raw text */
    }
    throwClassifiedHttpError(
      response.status,
      errorBody,
      errorResponse,
      response.headers as unknown as Headers,
      requestUrl,
      rateHint,
      failure,
    )
  }

  throw APIError.generate(
    500,
    undefined,
    'OpenAI shim: request loop exited unexpectedly',
    new Headers(),
  )
}
const CREDENTIAL_POOL_COOLDOWN_MS = 30_000
