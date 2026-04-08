/**
 * WebFetch provider adapter types.
 *
 * Each backend implements FetchProvider. The tool layer selects the right
 * one via WEB_FETCH_PROVIDER; shared logic (caching, content conversion,
 * prompt application) lives in the tool, not in adapters.
 */

export interface FetchResult {
  /** Raw content string (markdown or plain text) */
  content: string
  /** Size in bytes */
  bytes: number
  /** HTTP status code (200, 404, etc.) */
  code: number
  /** HTTP status text ("OK", "Not Found", etc.) */
  codeText: string
  /** Content-Type header value */
  contentType: string
  /** Path to persisted binary file (if applicable) */
  persistedPath?: string
  /** Size of persisted binary file */
  persistedSize?: number
}

export interface RedirectInfo {
  type: 'redirect'
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export interface FetchProvider {
  /** Human-readable label (used in logs, tool_use_id) */
  readonly name: string
  /** Returns true when the env vars / config needed for this provider are present */
  isConfigured(): boolean
  /** Fetch a URL and return content. Throw on unrecoverable errors. */
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo>
}

export type ProviderMode =
  | 'auto'
  | 'default'
  | 'firecrawl'
  | 'jina'
  | 'custom'
