import type * as undici from 'undici'
import { disableKeepAlive, getProxyFetchOptions, getProxyUrl } from '../../utils/proxy.js'

const RETRYABLE_FETCH_ERROR_PATTERN =
  /socket connection was closed unexpectedly|ECONNRESET|EPIPE|socket hang up|Connection reset by peer|fetch failed/i

export function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  if (error.name === 'AbortError') {
    return false
  }
  return RETRYABLE_FETCH_ERROR_PATTERN.test(error.message)
}

export async function fetchWithProxyRetry(
  input: string | URL | Request,
  init?: RequestInit,
  options?: {
    forAnthropicAPI?: boolean
    maxAttempts?: number
    /**
     * Optional scoped undici dispatcher for per-request transport behaviour
     * (e.g. IPv4-only DNS lookup). Only applied when no proxy dispatcher is
     * active — proxy environments let the proxy resolve hostnames.
     */
    dispatcher?: undici.Dispatcher
  },
): Promise<Response> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 2)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Fetch proxy options inside the loop so that changes from
      // disableKeepAlive() (called between retries) are picked up.
      const proxyOpts = getProxyFetchOptions({
        forAnthropicAPI: options?.forAnthropicAPI,
      })

      // Use the caller's scoped dispatcher only when no real proxy is active.
      // - If a proxy is configured, the proxy dispatcher handles DNS through the
      //   tunnel — a custom lookup dispatcher would be both unnecessary and would
      //   conflict, so we drop it.
      // - If only TLS options are active (no proxy URL), the scoped dispatcher
      //   already has TLS baked in (getDnsDispatcher merges getTLSConnectOptions),
      //   so we prefer it over the plain TLS-only dispatcher from proxyOpts.
      //   This preserves IPv4-first DNS for Opengateway users who also have
      //   enterprise mTLS/custom CA configured.
      const hasActiveProxy = Boolean(getProxyUrl())
      const scopedDispatcher =
        !hasActiveProxy && options?.dispatcher
          ? { dispatcher: options.dispatcher }
          : {}

      const response = await fetch(input, {
        ...init,
        ...scopedDispatcher,
        ...proxyOpts,
      })

      // If an upstream proxy or local NAT silently dropped the keep-alive socket,
      // it might result in a 502/504 response instead of a hard network exception.
      // We automatically disable keep-alive and retry to force a clean handshake.
      if (
        (response.status === 502 || response.status === 504) &&
        attempt < maxAttempts
      ) {
        disableKeepAlive()
        continue
      }

      return response
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error
      }
      disableKeepAlive()
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Fetch failed without an error object')
}
