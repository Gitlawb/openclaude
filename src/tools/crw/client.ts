import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'

// fastCRW: Firecrawl-compatible web scraper; single binary; self-host or cloud.
// Cloud base URL carries the `/api` suffix; self-host points CRW_API_URL at the
// local engine (which may require no auth key).
const DEFAULT_CRW_API_URL = 'https://fastcrw.com/api'
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BACKOFF_FACTOR_SECONDS = 0.5

interface CrwEnvelope<T> {
  success?: boolean
  data?: T
  error?: string
}

interface CrwWebResult {
  url: string
  title?: string
  description?: string
}

// fastCRW /v1/search returns a flat array of results under `data`.
type CrwSearchData = CrwWebResult[]

interface CrwScrapeData {
  markdown?: string
}

interface CrwRequestOptions {
  apiKey?: string | null
  apiUrl?: string | null
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
  backoffFactorSeconds?: number
}

interface CrwSearchOptions extends CrwRequestOptions {
  limit?: number
}

interface CrwScrapeOptions extends CrwRequestOptions {
  formats?: string[]
}

function getCrwConfig(options: CrwRequestOptions) {
  const apiKey = options.apiKey ?? process.env.CRW_API_KEY ?? ''
  const apiUrl = (options.apiUrl ?? process.env.CRW_API_URL ?? DEFAULT_CRW_API_URL).replace(/\/$/, '')

  if (apiUrl.includes('fastcrw.com') && !apiKey) {
    throw new Error(
      'fastCRW API key is required for the cloud API. Set CRW_API_KEY or use CRW_API_URL for a self-hosted instance.',
    )
  }

  return { apiKey, apiUrl }
}

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

async function parseCrwResponse<T>(
  response: Response,
  action: string,
): Promise<CrwEnvelope<T>> {
  const text = await response.text()
  let payload: CrwEnvelope<T> | undefined

  if (text) {
    try {
      payload = JSON.parse(text) as CrwEnvelope<T>
    } catch {
      if (!response.ok) {
        throw new Error(`fastCRW ${action} error ${response.status}: ${text}`)
      }
      throw new Error(`fastCRW ${action} returned invalid JSON`)
    }
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.error ?? text
    const suffix = detail ? `: ${detail}` : ''
    throw new Error(`fastCRW ${action} error ${response.status}${suffix}`)
  }

  return payload
}

async function postToCrw<T>(
  path: string,
  body: Record<string, unknown>,
  action: string,
  options: CrwRequestOptions,
): Promise<T> {
  const { apiKey, apiUrl } = getCrwConfig(options)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const backoffFactorSeconds = options.backoffFactorSeconds ?? DEFAULT_BACKOFF_FACTOR_SECONDS

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { signal, cleanup } = createCombinedAbortSignal(options.signal, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })

    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...body,
          origin: 'openclaude',
        }),
        signal,
      })

      if (response.status !== 502 || attempt === maxRetries - 1) {
        const payload = await parseCrwResponse<T>(response, action)
        return (payload.data ?? {}) as T
      }
    } finally {
      cleanup()
    }

    await sleep(backoffFactorSeconds * Math.pow(2, attempt))
  }

  throw new Error(`fastCRW ${action} failed before receiving a response`)
}

export async function crwSearch(
  query: string,
  options: CrwSearchOptions = {},
): Promise<CrwSearchData> {
  if (!query.trim()) {
    throw new Error('fastCRW query cannot be empty')
  }

  return postToCrw<CrwSearchData>(
    '/v1/search',
    {
      query,
      limit: options.limit ?? 15,
    },
    'search',
    options,
  )
}

export async function crwScrape(
  url: string,
  options: CrwScrapeOptions = {},
): Promise<CrwScrapeData> {
  if (!url.trim()) {
    throw new Error('fastCRW URL cannot be empty')
  }

  return postToCrw<CrwScrapeData>(
    '/v1/scrape',
    {
      url,
      formats: options.formats ?? ['markdown'],
    },
    'scrape',
    options,
  )
}
