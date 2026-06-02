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

/**
 * Lazily-loaded undici fetch for Bun compatibility. Bun's native fetch ignores
 * undici dispatchers, so when we need a scoped dispatcher (e.g. IPv4-first DNS)
 * we route through undici's own fetch implementation instead.
 */
let _undiciFetch: typeof globalThis.fetch | undefined
function getUndiciFetch(): typeof globalThis.fetch | undefined {
  if (_undiciFetch) return _undiciFetch
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undiciMod = require('undici') as typeof undici
    _undiciFetch = undiciMod.fetch as unknown as typeof globalThis.fetch
    return _undiciFetch
  } catch {
    return undefined
  }
}

/** @internal — test seam to clear the cached undici fetch reference */
export function _resetUndiciFetchForTesting(): void {
  _undiciFetch = undefined
}

/** @internal — test seam to inject a mock undici fetch without mock.module() */
export function _setUndiciFetchForTesting(fn: typeof globalThis.fetch): void {
  _undiciFetch = fn
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
     *
     * When running under Bun and a dispatcher is provided, we automatically
     * route through undici's own fetch (not Bun's native fetch) because
     * Bun's fetch ignores undici dispatchers. This preserves the original
     * URL hostname for correct TLS SNI/certificate validation.
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

      // Use the caller's scoped dispatcher only when the request is NOT going
      // through a proxy tunnel:
      // - If a proxy URL is set AND this URL is not in NO_PROXY, the proxy
      //   dispatcher handles DNS through the tunnel — a custom lookup dispatcher
      //   would conflict, so we drop it.
      // - If no proxy is configured, or this URL is bypassed by NO_PROXY (i.e.
      //   the request goes direct), we apply the scoped dispatcher. It already
      //   merges getTLSConnectOptions, so mTLS/custom CA are preserved too.
      const requestUrl = input instanceof Request ? input.url : String(input)
      const proxyIsActive = Boolean(getProxyUrl()) && !shouldBypassProxy(requestUrl)
      const useDispatcher = !proxyIsActive && options?.dispatcher
      const scopedDispatcher = useDispatcher
          ? { dispatcher: options!.dispatcher }
          : {}

      // getProxyFetchOptions() is URL-unaware: under Bun it returns
      // { proxy: proxyUrl } whenever a proxy env var is set, even for URLs
      // that NO_PROXY says should go direct. Strip the proxy key here so
      // bypassed requests are truly sent without a proxy tunnel.
      const { proxy: _unusedProxy, ...proxyOptsWithoutProxy } = proxyOpts as typeof proxyOpts & { proxy?: string }
      const effectiveProxyOpts = proxyIsActive ? proxyOpts : proxyOptsWithoutProxy

      // Bun's native fetch ignores undici dispatchers, so when we need a
      // scoped dispatcher under Bun, route through undici's own fetch.
      // This preserves the original URL hostname for TLS SNI/certificate
      // validation — unlike the old approach of rewriting URLs to IP addresses.
      const fetchFn = (useDispatcher && typeof Bun !== 'undefined')
        ? (getUndiciFetch() ?? fetch)
        : fetch

      const response = await fetchFn(input, {
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
