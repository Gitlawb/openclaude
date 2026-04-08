/**
 * Default (direct HTTP) fetch provider.
 * Always available. Uses axios for direct fetching with HTML→Markdown, redirects, retry.
 */
import axios from 'axios'
import { getWebFetchUserAgent } from '../../../utils/http.js'
import { logError } from '../../../utils/log.js'
import { getAPIProvider } from '../../../utils/model/providers.js'
import { isBinaryContentType, persistBinaryContent } from '../../../utils/mcpOutputStorage.js'
import { getSettings_DEPRECATED } from '../../../utils/settings/settings.js'
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

const MAX_HTTP = 10 * 1024 * 1024
const DEFAULT_TIMEOUT = 60
const DOMAIN_TIMEOUT = 10_000
const MAX_REDIRECTS = 10

function getTimeoutMs(): number {
  const v = Number(process.env.WEB_FETCH_TIMEOUT_SEC)
  return (Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT) * 1000
}

type TurndownCtor = typeof import('turndown')
let td: Promise<InstanceType<TurndownCtor>> | undefined
function getTurndown() {
  return (td ??= import('turndown').then(m => new (m as unknown as { default: TurndownCtor }).default()))
}

export async function checkDomainBlocklist(domain: string): Promise<{ status: 'allowed' | 'blocked' | 'check_failed'; error?: Error }> {
  if (getAPIProvider() !== 'firstParty') return { status: 'allowed' }
  try {
    const r = await axios.get(`https://api.anthropic.com/api/web/domain_info?domain=${encodeURIComponent(domain)}`, { timeout: DOMAIN_TIMEOUT })
    if (r.status === 200) return r.data.can_fetch === true ? { status: 'allowed' } : { status: 'blocked' }
    return { status: 'check_failed' as const, error: new Error(`status ${r.status}`) }
  } catch (e) { logError(e); return { status: 'check_failed' as const, error: e as Error } }
}

function safeRedirect(ori: string, red: string): boolean {
  try {
    const o = new URL(ori), r = new URL(red)
    if (r.protocol !== o.protocol || r.port !== o.port || r.username || r.password) return false
    return o.hostname.replace(/^www\./, '') === r.hostname.replace(/^www\./, '')
  } catch { return false }
}

async function fetchWithRedirects(url: string, signal: AbortSignal, depth = 0): Promise<axios.AxiosResponse<ArrayBuffer> | RedirectInfo> {
  if (depth > MAX_REDIRECTS) throw new Error(`Too many redirects (>${MAX_REDIRECTS})`)
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await axios.get(url, { signal, timeout: getTimeoutMs(), maxRedirects: 0, responseType: 'arraybuffer', maxContentLength: MAX_HTTP, headers: { Accept: 'text/markdown, text/html, */*', 'User-Agent': getWebFetchUserAgent() } })
    } catch (err) {
      lastErr = err
      if (axios.isAxiosError(err) && err.response && [301, 302, 307, 308].includes(err.response.status)) {
        const loc = err.response.headers.location
        if (!loc) throw new Error('Redirect missing Location header')
        const redir = new URL(loc, url).toString()
        if (safeRedirect(url, redir)) return fetchWithRedirects(redir, signal, depth + 1)
        return { type: 'redirect', originalUrl: url, redirectUrl: redir, statusCode: err.response.status }
      }
      if (signal?.aborted || (axios.isAxiosError(err) && err.code === 'ERR_CANCELED')) throw err
      const s = axios.isAxiosError(err) ? err.response?.status : undefined
      if (attempt === 0 && (s === undefined || s >= 500)) { await new Promise(r => setTimeout(r, 500)); continue }
      throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export const defaultProvider: FetchProvider = {
  name: 'default',
  isConfigured() { return true },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    let fetchUrl = url
    try {
      const p = new URL(url)
      if (p.protocol === 'http:') { p.protocol = 'https:'; fetchUrl = p.toString() }
      if (!getSettings_DEPRECATED().skipWebFetchPreflight) {
        const cr = await checkDomainBlocklist(p.hostname)
        if (cr.status === 'blocked') throw new Error(`Cannot fetch from ${p.hostname}`)
        if (cr.status === 'check_failed') throw new Error(`Cannot verify ${p.hostname}`)
      }
    } catch (e) { if ((e as Error).message.includes('Cannot')) throw e; logError(e) }

    const resp = await fetchWithRedirects(fetchUrl, signal ?? new AbortController().signal)
    if ('type' in resp && resp.type === 'redirect') return resp

    const buf = Buffer.from(resp.data)
    const ct = resp.headers['content-type'] ?? ''
    let persistedPath: string | undefined, persistedSize: number | undefined
    if (isBinaryContentType(ct)) {
      const r = await persistBinaryContent(buf, ct, `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      if (!('error' in r)) { persistedPath = r.filepath; persistedSize = r.size }
    }
    const content = ct.includes('text/html') ? (await getTurndown()).turndown(buf.toString('utf-8')) : buf.toString('utf-8')
    return { content, bytes: buf.length, code: resp.status, codeText: resp.statusText, contentType: ct, persistedPath, persistedSize }
  },
}
