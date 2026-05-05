const DEFAULT_FIRECRAWL_API_URL = 'https://api.firecrawl.dev'
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BACKOFF_FACTOR_SECONDS = 0.5

interface FirecrawlEnvelope<T> {
  success?: boolean
  data?: T
  error?: string
}

interface FirecrawlWebResult {
  url: string
  title?: string
  description?: string
}

interface FirecrawlSearchData {
  web?: FirecrawlWebResult[]
}

interface FirecrawlScrapeData {
  markdown?: string
}

interface FirecrawlRequestOptions {
  apiKey?: string | null
  apiUrl?: string | null
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
  backoffFactorSeconds?: number
}

interface FirecrawlSearchOptions extends FirecrawlRequestOptions {
  limit?: number
}

interface FirecrawlScrapeOptions extends FirecrawlRequestOptions {
  formats?: string[]
}

function getFirecrawlConfig(options: FirecrawlRequestOptions) {
  const apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? ''
  const apiUrl = (options.apiUrl ?? process.env.FIRECRAWL_API_URL ?? DEFAULT_FIRECRAWL_API_URL).replace(/\/$/, '')

  if (apiUrl.includes('api.firecrawl.dev') && !apiKey) {
    throw new Error(
      'Firecrawl API key is required for the cloud API. Set FIRECRAWL_API_KEY or use FIRECRAWL_API_URL for a self-hosted instance.',
    )
  }

  return { apiKey, apiUrl }
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

async function parseFirecrawlResponse<T>(
  response: Response,
  action: string,
): Promise<FirecrawlEnvelope<T>> {
  const text = await response.text()
  let payload: FirecrawlEnvelope<T> | undefined

  if (text) {
    try {
      payload = JSON.parse(text) as FirecrawlEnvelope<T>
    } catch {
      if (!response.ok) {
        throw new Error(`Firecrawl ${action} error ${response.status}: ${text}`)
      }
      throw new Error(`Firecrawl ${action} returned invalid JSON`)
    }
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.error ?? text
    const suffix = detail ? `: ${detail}` : ''
    throw new Error(`Firecrawl ${action} error ${response.status}${suffix}`)
  }

  return payload
}

async function postToFirecrawl<T>(
  path: string,
  body: Record<string, unknown>,
  action: string,
  options: FirecrawlRequestOptions,
): Promise<T> {
  const { apiKey, apiUrl } = getFirecrawlConfig(options)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const backoffFactorSeconds = options.backoffFactorSeconds ?? DEFAULT_BACKOFF_FACTOR_SECONDS

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  let response: Response | undefined
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...body,
        origin: 'openclaude',
      }),
      signal: withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

    if (response.status !== 502 || attempt === maxRetries - 1) {
      break
    }

    await sleep(backoffFactorSeconds * Math.pow(2, attempt))
  }

  const payload = await parseFirecrawlResponse<T>(response!, action)
  return (payload.data ?? {}) as T
}

export async function firecrawlSearch(
  query: string,
  options: FirecrawlSearchOptions = {},
): Promise<FirecrawlSearchData> {
  if (!query.trim()) {
    throw new Error('Firecrawl query cannot be empty')
  }

  return postToFirecrawl<FirecrawlSearchData>(
    '/v2/search',
    {
      query,
      limit: options.limit ?? 15,
    },
    'search',
    options,
  )
}

export async function firecrawlScrape(
  url: string,
  options: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeData> {
  if (!url.trim()) {
    throw new Error('Firecrawl URL cannot be empty')
  }

  return postToFirecrawl<FirecrawlScrapeData>(
    '/v2/scrape',
    {
      url,
      formats: options.formats ?? ['markdown'],
    },
    'scrape',
    options,
  )
}
