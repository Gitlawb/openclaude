import type * as undici from 'undici'
import { disableKeepAlive, getProxyFetchOptions, getProxyUrl, shouldBypassProxy } from '../../utils/proxy.js'

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
    /**
     * The logical/provider URL to use for NO_PROXY matching instead of the
     * actual request URL. Required when the request URL has been rewritten
     * (e.g. Bun's IPv4 DNS pre-resolution replaces the hostname with an IP
     * address, which would defeat hostname-based NO_PROXY rules).
     */
    proxyDecisionUrl?: string
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

      // Use the caller's scoped dispatcher only when the request is NOT going
      // through a proxy tunnel:
      // - If a proxy URL is set AND this URL is not in NO_PROXY, the proxy
      //   dispatcher handles DNS through the tunnel — a custom lookup dispatcher
      //   would conflict, so we drop it.
      // - If no proxy is configured, or this URL is bypassed by NO_PROXY (i.e.
      //   the request goes direct), we apply the scoped dispatcher. It already
      //   merges getTLSConnectOptions, so mTLS/custom CA are preserved too.
      //
      // proxyDecisionUrl: When the request URL has been rewritten (e.g. Bun
      // IPv4 pre-resolution replaces the hostname with an IP), use the
      // original logical URL so NO_PROXY hostname matching still works.
      const requestUrl = input instanceof Request ? input.url : String(input)
      const urlForBypass = options?.proxyDecisionUrl ?? requestUrl
      const proxyIsActive = Boolean(getProxyUrl()) && !shouldBypassProxy(urlForBypass)
      const scopedDispatcher =
        !proxyIsActive && options?.dispatcher
          ? { dispatcher: options.dispatcher }
          : {}

      // getProxyFetchOptions() is URL-unaware: under Bun it returns
      // { proxy: proxyUrl } whenever a proxy env var is set, even for URLs
      // that NO_PROXY says should go direct. Strip the proxy key here so
      // bypassed requests are truly sent without a proxy tunnel.
      const { proxy: _unusedProxy, ...proxyOptsWithoutProxy } = proxyOpts as typeof proxyOpts & { proxy?: string }
      const effectiveProxyOpts = proxyIsActive ? proxyOpts : proxyOptsWithoutProxy

      const response = await fetch(input, {
        ...init,
        ...effectiveProxyOpts,
        ...scopedDispatcher,
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
