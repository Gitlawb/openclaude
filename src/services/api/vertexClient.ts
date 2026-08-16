import { BaseAnthropic, type ClientOptions } from '@anthropic-ai/sdk/client'
import * as Resources from '@anthropic-ai/sdk/resources/index'

const DEFAULT_VERSION = 'vertex-2023-10-16'
const MODEL_ENDPOINTS = new Set(['/v1/messages', '/v1/messages?beta=true'])

type VertexAuthHeaders = HeadersInit | Record<string, string | undefined>

// The base client passes its already-parsed request headers into prepareOptions
// (HeadersLike, which includes the internal NullableHeaders wrapper). Accept
// that shape in the merge helpers in addition to the google-auth header shapes
// so the types line up with what the SDK actually hands us.
type RequestHeaders = Parameters<BaseAnthropic['prepareOptions']>[0]['headers']

type VertexAuthClient = {
  projectId?: string | null
  getRequestHeaders: () => VertexAuthHeaders | Promise<VertexAuthHeaders>
}

type VertexGoogleAuth = {
  getClient: () => VertexAuthClient | Promise<VertexAuthClient>
}

type AnthropicVertexOptions = Omit<ClientOptions, 'baseURL'> & {
  authClient?: VertexAuthClient
  baseURL?: string | null
  googleAuth?: VertexGoogleAuth
  projectId?: string | null
  region?: string | null
}

function readEnv(name: string): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env[name]
}

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function setHeader(
  target: Headers,
  key: string,
  value: string | undefined | null,
): void {
  if (value !== undefined && value !== null) {
    target.set(key, value)
  }
}

function appendHeaders(
  target: Headers,
  source: VertexAuthHeaders | RequestHeaders,
): void {
  if (!source) {
    return
  }

  if (source instanceof Headers) {
    source.forEach((value, key) => target.set(key, value))
    return
  }

  // NullableHeaders (the base client's parsed request headers):
  // { values: Headers, nulls: Set<string> } — copy values, honor explicit unsets.
  if (
    typeof source === 'object' &&
    !Array.isArray(source) &&
    'values' in source &&
    source.values instanceof Headers
  ) {
    source.values.forEach((value, key) => target.set(key, value))
    const nulls = (source as { nulls?: unknown }).nulls
    if (nulls instanceof Set) {
      for (const key of nulls as Set<string>) {
        target.delete(key)
      }
    }
    return
  }

  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      setHeader(target, key as string, value as string | undefined | null)
    }
    return
  }

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        setHeader(target, key, v as string | undefined | null)
      }
    } else {
      setHeader(target, key, value as string | undefined | null)
    }
  }
}

function mergeHeaders(
  ...sources: (VertexAuthHeaders | RequestHeaders)[]
): Headers {
  const headers = new Headers()
  for (const source of sources) {
    appendHeaders(headers, source)
  }
  return headers
}

function getHeaderValue(
  source: VertexAuthHeaders,
  headerName: string,
): string | undefined {
  if (source instanceof Headers) {
    return source.get(headerName) ?? undefined
  }

  const normalizedName = headerName.toLowerCase()
  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      if (key.toLowerCase() === normalizedName) {
        return value
      }
    }
    return undefined
  }

  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase() === normalizedName) {
      return value
    }
  }

  return undefined
}

export class AnthropicVertex extends BaseAnthropic {
  // Re-declare the resource surface that the upstream @anthropic-ai/vertex-sdk
  // client exposed. BaseAnthropic does not declare these, so typed consumers
  // (client.ts, the SDK calling `.messages`) would otherwise lose the types.
  messages: Omit<Resources.Messages, 'batches'>
  beta: Omit<Resources.Beta, 'messages'> & { messages: Omit<Resources.Beta.Messages, 'batches'> }
  region: string
  projectId: string | null
  private readonly authClientPromise: Promise<VertexAuthClient>

  constructor({
    authClient,
    baseURL = readEnv('ANTHROPIC_VERTEX_BASE_URL'),
    googleAuth,
    projectId = readEnv('ANTHROPIC_VERTEX_PROJECT_ID') ?? null,
    region = readEnv('CLOUD_ML_REGION') ?? null,
    ...opts
  }: AnthropicVertexOptions = {}) {
    if (!region) {
      throw new Error(
        'No region was given. The client should be instantiated with the `region` option or the `CLOUD_ML_REGION` environment variable should be set.',
      )
    }

    let resolvedBaseURL = baseURL
    if (!resolvedBaseURL) {
      switch (region) {
        case 'global':
          resolvedBaseURL = 'https://aiplatform.googleapis.com/v1'
          break
        case 'us':
          resolvedBaseURL = 'https://aiplatform.us.rep.googleapis.com/v1'
          break
        case 'eu':
          resolvedBaseURL = 'https://aiplatform.eu.rep.googleapis.com/v1'
          break
        default:
          resolvedBaseURL = `https://${region}-aiplatform.googleapis.com/v1`
      }
    }

    super({
      baseURL: resolvedBaseURL,
      ...opts,
    })

    this.messages = makeMessagesResource(this)
    this.beta = makeBetaResource(this)
    this.region = region
    this.projectId = projectId

    if (authClient && googleAuth) {
      throw new Error(
        'You cannot provide both `authClient` and `googleAuth`. Please provide only one of them.',
      )
    }

    if (authClient) {
      this.authClientPromise = Promise.resolve(authClient)
    } else if (googleAuth) {
      this.authClientPromise = Promise.resolve(googleAuth.getClient())
    } else {
      throw new Error('A `googleAuth` or `authClient` option is required.')
    }
  }

  override validateHeaders(): void {
    // Vertex auth headers are resolved asynchronously in prepareOptions.
  }

  override async prepareOptions(
    options: Parameters<BaseAnthropic['prepareOptions']>[0],
  ): Promise<void> {
    const authClient = await this.authClientPromise
    const authHeaders = await authClient.getRequestHeaders()
    const projectId =
      authClient.projectId ?? getHeaderValue(authHeaders, 'x-goog-user-project')

    if (!this.projectId && projectId) {
      this.projectId = projectId
    }

    // Resolved Google auth headers MUST win: merge them last so a caller-supplied
    // Authorization / x-goog-user-project can't override the Vertex credential
    // and send the wrong token upstream. Other request headers still pass through.
    options.headers = mergeHeaders(options.headers, authHeaders)
  }

  override async buildRequest(
    options: Parameters<BaseAnthropic['buildRequest']>[0],
  ): ReturnType<BaseAnthropic['buildRequest']> {
    if (isObj(options.body)) {
      options.body = { ...options.body }
    }

    if (isObj(options.body) && !options.body['anthropic_version']) {
      options.body['anthropic_version'] = DEFAULT_VERSION
    }

    if (MODEL_ENDPOINTS.has(options.path) && options.method === 'post') {
      if (!this.projectId) {
        throw new Error(
          'No projectId was given and it could not be resolved from credentials. The client should be instantiated with the `projectId` option or the `ANTHROPIC_VERTEX_PROJECT_ID` environment variable should be set.',
        )
      }

      if (!isObj(options.body)) {
        throw new Error('Expected request body to be an object for post /v1/messages')
      }

      const model = options.body['model']
      if (typeof model !== 'string' || model.trim() === '') {
        throw new Error(
          'Expected `model` to be a non-empty string for post /v1/messages',
        )
      }
      delete options.body['model']
      const stream = options.body['stream'] ?? false
      const specifier = stream ? 'streamRawPredict' : 'rawPredict'
      options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${encodeURIComponent(model)}:${specifier}`
    }

    if (
      options.method === 'post' &&
      (options.path === '/v1/messages/count_tokens' ||
        options.path === '/v1/messages/count_tokens?beta=true')
    ) {
      if (!this.projectId) {
        throw new Error(
          'No projectId was given and it could not be resolved from credentials. The client should be instantiated with the `projectId` option or the `ANTHROPIC_VERTEX_PROJECT_ID` environment variable should be set.',
        )
      }

      options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/count-tokens:rawPredict`
    }

    return super.buildRequest(options)
  }
}

function makeMessagesResource(client: BaseAnthropic): Resources.Messages {
  const resource = new Resources.Messages(client)
  delete (resource as Partial<Resources.Messages>).batches
  return resource
}

function makeBetaResource(client: BaseAnthropic): Resources.Beta {
  const resource = new Resources.Beta(client)
  delete (resource.messages as Partial<Resources.Beta.Messages>).batches
  return resource
}
