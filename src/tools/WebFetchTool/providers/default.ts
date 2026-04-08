/**
 * Default WebFetch provider.
 *
 * Uses axios to fetch URLs directly. This is the original fetching behavior
 * extracted into a provider adapter. Supports:
 * - HTTP→HTTPS upgrade
 * - Same-host redirect following (www. variations, path changes)
 * - Binary content persistence
 * - HTML→Markdown conversion via Turndown
 * - Domain blocklist preflight (firstParty only)
 * - One retry on 5xx/network errors
 */

import axios from 'axios'
import { getWebFetchUserAgent } from '../../../utils/http.js'
import { logError } from '../../../utils/log.js'
import { getAPIProvider } from '../../../utils/model/providers.js'
import {
  isBinaryContentType,
  persistBinaryContent,
} from '../../../utils/mcpOutputStorage.js'
import { getSettings_DEPRECATED } from '../../../utils/settings/settings.js'
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024 // 10MB
const DEFAULT_FETCH_TIMEOUT_SECONDS = 60
const DOMAIN_CHECK_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 10

function getFetchTimeoutMs(): number {
  const envVal = Number(process.env.WEB_FETCH_TIMEOUT_SEC)
  return (Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_FETCH_TIMEOUT_SECONDS) * 1000
}

// ---------------------------------------------------------------------------
// Turndown (lazy singleton)
// ---------------------------------------------------------------------------

type TurndownCtor = typeof import('turndown')
let turndownServicePromise: Promise<InstanceType<TurndownCtor>> | undefined
function getTurndownService(): Promise<InstanceType<TurndownCtor>> {
  return (turndownServicePromise ??= import('turndown').then(m => {
    const Turndown = (m as unknown as { default: TurndownCtor }).default
    return new Turndown()
  }))
}

// ---------------------------------------------------------------------------
// Domain blocklist (firstParty only)
// ---------------------------------------------------------------------------

class DomainBlockedError extends Error {
  constructor(domain: string) {
    super(`Claude Code is unable to fetch from ${domain}`)
    this.name = 'DomainBlockedError'
  }
}

class DomainCheckFailedError extends Error {
  constructor(domain: string) {
    super(
      `Unable to verify if domain ${domain} is safe to fetch. This may be due to network restrictions or enterprise security policies blocking claude.ai.`,
    )
    this.name = 'DomainCheckFailedError'
  }
}

type DomainCheckResult =
  | { status: 'allowed' }
  | { status: 'blocked' }
  | { status: 'check_failed'; error: Error }

export async function checkDomainBlocklist(domain: string): Promise<DomainCheckResult> {
  if (getAPIProvider() !== 'firstParty') {
    return { status: 'allowed' }
  }
  try {
    const response = await axios.get(
      `https://api.anthropic.com/api/web/domain_info?domain=${encodeURIComponent(domain)}`,
      { timeout: DOMAIN_CHECK_TIMEOUT_MS },
    )
    if (response.status === 200) {
      if (response.data.can_fetch === true) return { status: 'allowed' }
      return { status: 'blocked' }
    }
    return { status: 'check_failed', error: new Error(`Domain check returned status ${response.status}`) }
  } catch (e) {
    logError(e)
    return { status: 'check_failed', error: e as Error }
  }
}

// ---------------------------------------------------------------------------
// Redirect handling
// ---------------------------------------------------------------------------

function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const parsedOriginal = new URL(originalUrl)
    const parsedRedirect = new URL(redirectUrl)
    if (parsedRedirect.protocol !== parsedOriginal.protocol) return false
    if (parsedRedirect.port !== parsedOriginal.port) return false
    if (parsedRedirect.username || parsedRedirect.password) return false
    const stripWww = (h: string) => h.replace(/^www\./, '')
    return stripWww(parsedOriginal.hostname) === stripWww(parsedRedirect.hostname)
  } catch {
    return false
  }
}

async function getWithPermittedRedirects(
  url: string,
  signal: AbortSignal,
  depth = 0,
): Promise<axios.AxiosResponse<ArrayBuffer> | RedirectInfo> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`)
  }

  const fetchTimeoutMs = getFetchTimeoutMs()
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await axios.get(url, {
        signal,
        timeout: fetchTimeoutMs,
        maxRedirects: 0,
        responseType: 'arraybuffer',
        maxContentLength: MAX_HTTP_CONTENT_LENGTH,
        headers: {
          Accept: 'text/markdown, text/html, */*',
          'User-Agent': getWebFetchUserAgent(),
        },
      })
    } catch (error) {
      lastError = error

      // Redirects
      if (axios.isAxiosError(error) && error.response && [301, 302, 307, 308].includes(error.response.status)) {
        const redirectLocation = error.response.headers.location
        if (!redirectLocation) throw new Error('Redirect missing Location header')
        const redirectUrl = new URL(redirectLocation, url).toString()
        if (isPermittedRedirect(url, redirectUrl)) {
          return getWithPermittedRedirects(redirectUrl, signal, depth + 1)
        }
        return { type: 'redirect', originalUrl: url, redirectUrl, statusCode: error.response.status }
      }

      // Egress proxy blocks
      if (axios.isAxiosError(error) && error.response?.status === 403 && error.response.headers['x-proxy-error'] === 'blocked-by-allowlist') {
        throw new Error(`Access to ${new URL(url).hostname} is blocked by the network egress proxy.`)
      }

      // Abort
      if (signal?.aborted || (axios.isAxiosError(error) && error.code === 'ERR_CANCELED')) {
        throw error
      }

      // Retry on 5xx / network errors
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      if (attempt === 0 && (status === undefined || (status >= 500 && status < 600))) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }

      throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// ---------------------------------------------------------------------------
// Provider export
// ---------------------------------------------------------------------------

export const defaultProvider: FetchProvider = {
  name: 'default',

  isConfigured() {
    return true // always available
  },

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    // Upgrade http → https
    let fetchUrl = url
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:') {
        parsed.protocol = 'https:'
        fetchUrl = parsed.toString()
      }

      // Domain blocklist preflight (firstParty only)
      const settings = getSettings_DEPRECATED()
      if (!settings.skipWebFetchPreflight) {
        const checkResult = await checkDomainBlocklist(parsed.hostname)
        if (checkResult.status === 'blocked') throw new DomainBlockedError(parsed.hostname)
        if (checkResult.status === 'check_failed') throw new DomainCheckFailedError(parsed.hostname)
      }
    } catch (e) {
      if (e instanceof DomainBlockedError || e instanceof DomainCheckFailedError) throw e
      logError(e)
    }

    const response = await getWithPermittedRedirects(fetchUrl, signal ?? new AbortController().signal)
    if ('type' in response && response.type === 'redirect') return response

    const rawBuffer = Buffer.from(response.data)
    const contentType = response.headers['content-type'] ?? ''

    let persistedPath: string | undefined
    let persistedSize: number | undefined
    if (isBinaryContentType(contentType)) {
      const persistId = `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const result = await persistBinaryContent(rawBuffer, contentType, persistId)
      if (!('error' in result)) {
        persistedPath = result.filepath
        persistedSize = result.size
      }
    }

    const bytes = rawBuffer.length
    const htmlContent = rawBuffer.toString('utf-8')

    let content: string
    if (contentType.includes('text/html')) {
      content = (await getTurndownService()).turndown(htmlContent)
    } else {
      content = htmlContent
    }

    return {
      content,
      bytes,
      code: response.status,
      codeText: response.statusText,
      contentType,
      persistedPath,
      persistedSize,
    }
  },
}
