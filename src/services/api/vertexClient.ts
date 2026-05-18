import { BaseAnthropic, type ClientOptions } from '@anthropic-ai/sdk/client'
import * as Resources from '@anthropic-ai/sdk/resources/index'

const DEFAULT_VERSION = 'vertex-2023-10-16'
const MODEL_ENDPOINTS = new Set(['/v1/messages', '/v1/messages?beta=true'])

type VertexAuthHeaders = HeadersInit | Record<string, string | undefined>

type VertexAuthClient = {
  projectId?: string | null
  getRequestHeaders: () => VertexAuthHeaders | Promise<VertexAuthHeaders>
}

type VertexGoogleAuth = {
  getClient: () => VertexAuthClient | Promise<VertexAuthClient>
}

type AnthropicVertexOptions = Omit<ClientOptions, 'baseURL'> & {
  accessToken?: string | null
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

function appendHeaders(target: Headers, source: VertexAuthHeaders | undefined): void {
  if (!source) {
    return
  }

  if (source instanceof Headers) {
    source.forEach((value, key) => target.set(key, value))
    return
  }

  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      target.set(key, value)
    }
    return
  }

  for (const [key, value] of Object.entries(source)) {
    setHeader(target, key, value)
  }
}

function mergeHeaders(...sources: (VertexAuthHeaders | undefined)[]): Headers {
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
  region: string
  projectId: string | null
  accessToken: string | null
  private readonly authClientPromise: Promise<VertexAuthClient>

  constructor({
    accessToken = null,
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
    this.accessToken = accessToken

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

    options.headers = mergeHeaders(authHeaders, options.headers)
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
      delete options.body['model']
      const stream = options.body['stream'] ?? false
      const specifier = stream ? 'streamRawPredict' : 'rawPredict'
      options.path = `/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${model}:${specifier}`
    }

    if (
      options.path === '/v1/messages/count_tokens' ||
      (options.path === '/v1/messages/count_tokens?beta=true' &&
        options.method === 'post')
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
