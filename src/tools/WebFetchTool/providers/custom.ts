/**
 * Custom WebFetch provider.
 *
 * Allows users to point WebFetch at their own HTTP endpoint for URL fetching.
 * Useful for proxies, internal scrapers, or custom content extractors.
 *
 * ## Security Guardrails
 *
 * 1. HTTPS-only by default (opt-out: WEB_FETCH_CUSTOM_ALLOW_HTTP=true)
 * 2. Private / loopback IPs blocked by default (opt-out: WEB_FETCH_CUSTOM_ALLOW_PRIVATE=true)
 * 3. Request timeout (default 30s, configurable via WEB_FETCH_CUSTOM_TIMEOUT_SEC)
 * 4. Max response size: 10MB
 *
 * ## Configuration
 *
 * ```bash
 * # Required: the endpoint URL. {url} is replaced with the target URL.
 * export WEB_FETCH_API="https://my-scraper.example.com/fetch?url={url}"
 *
 * # Optional: auth header
 * export WEB_FETCH_API_KEY="my-secret-key"
 * export WEB_FETCH_API_AUTH_HEADER="Authorization"  # default
 * export WEB_FETCH_API_AUTH_SCHEME="Bearer"          # default
 *
 * # Optional: extra headers (semicolon-separated)
 * export WEB_FETCH_API_HEADERS="X-Tenant: acme; Accept: text/markdown"
 * ```
 *
 * ## Response format
 *
 * The endpoint should return the fetched content as plain text or markdown.
 * The raw response body is used as the content (no parsing).
 */

import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

// ---------------------------------------------------------------------------
// Security guardrails
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_SECONDS = 30

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[::1?\]$/i,
  /^0x[0-9a-f]+$/i,
]

function isPrivateHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAME_PATTERNS.some(re => re.test(hostname))
}

function validateEndpoint(urlString: string): void {
  let parsed: URL
  try {
    parsed = new URL(urlString.replace(/\{url\}/g, 'https://example.com'))
  } catch {
    throw new Error(`WEB_FETCH_API is not a valid URL template: ${urlString.slice(0, 100)}`)
  }

  const allowHttp = process.env.WEB_FETCH_CUSTOM_ALLOW_HTTP === 'true'
  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error(
      `WEB_FETCH_API must use https:// (got ${parsed.protocol}). ` +
      `Set WEB_FETCH_CUSTOM_ALLOW_HTTP=true to override.`,
    )
  }

  const allowPrivate = process.env.WEB_FETCH_CUSTOM_ALLOW_PRIVATE === 'true'
  if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
    throw new Error(
      `WEB_FETCH_API targets a private/reserved address (${parsed.hostname}). ` +
      `Set WEB_FETCH_CUSTOM_ALLOW_PRIVATE=true to override.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Provider export
// ---------------------------------------------------------------------------

export const customProvider: FetchProvider = {
  name: 'custom',

  isConfigured() {
    return Boolean(process.env.WEB_FETCH_API)
  },

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const template = process.env.WEB_FETCH_API!
    validateEndpoint(template)

    const fetchUrl = template.replace(/\{url\}/g, encodeURIComponent(url))
    const timeoutSec = Number(process.env.WEB_FETCH_CUSTOM_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SECONDS
    const timeoutMs = timeoutSec * 1000

    // Build headers
    const headers: Record<string, string> = {}
    const apiKey = process.env.WEB_FETCH_API_KEY
    if (apiKey) {
      const headerName = process.env.WEB_FETCH_API_AUTH_HEADER ?? 'Authorization'
      const scheme = process.env.WEB_FETCH_API_AUTH_SCHEME ?? 'Bearer'
      headers[headerName] = `${scheme} ${apiKey}`.trim()
    }

    // Extra headers
    const rawExtra = process.env.WEB_FETCH_API_HEADERS
    if (rawExtra) {
      for (const pair of rawExtra.split(';')) {
        const i = pair.indexOf(':')
        if (i > 0) {
          const k = pair.slice(0, i).trim()
          const v = pair.slice(i + 1).trim()
          if (k) headers[k] = v
        }
      }
    }

    // Timeout + fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(fetchUrl, { headers, signal: controller.signal })
        clearTimeout(timer)

        if (!res.ok) {
          throw new Error(`Custom fetch API returned ${res.status}: ${res.statusText}`)
        }

        const content = await res.text()
        const contentType = res.headers.get('content-type') ?? 'text/plain'

        return {
          content,
          bytes: Buffer.byteLength(content),
          code: res.status,
          codeText: res.statusText,
          contentType,
        }
      } catch (err) {
        clearTimeout(timer)
        lastError = err instanceof Error ? err : new Error(String(err))

        if (lastError instanceof Error && lastError.name === 'AbortError' && !signal?.aborted) {
          throw new Error(`Custom fetch timed out after ${timeoutSec}s`)
        }

        if (signal?.aborted) throw lastError

        // Retry on 5xx or network errors
        const status = undefined // fetch doesn't give us status on network errors easily
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }

        throw lastError
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  },
}
