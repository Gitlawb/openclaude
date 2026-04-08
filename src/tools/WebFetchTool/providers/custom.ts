/** Custom — user-configured HTTP endpoint. WEB_FETCH_API */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

const TIMEOUT = 30
const BLOCKED = [/^localhost$/i,/^127\.\d+\.\d+\.\d+$/,/^10\.\d+\.\d+\.\d+$/,/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,/^192\.168\.\d+\.\d+$/,/^0\.0\.0\.0$/]

function validate(t: string) {
  const u = new URL(t.replace(/\{url\}/g, 'https://example.com'))
  if (process.env.WEB_FETCH_CUSTOM_ALLOW_HTTP !== 'true' && u.protocol !== 'https:') throw new Error(`WEB_FETCH_API must use https://`)
  if (process.env.WEB_FETCH_CUSTOM_ALLOW_PRIVATE !== 'true' && BLOCKED.some(r => r.test(u.hostname))) throw new Error(`WEB_FETCH_API targets private ${u.hostname}`)
}

export const customProvider: FetchProvider = {
  name: 'custom',
  isConfigured() { return Boolean(process.env.WEB_FETCH_API) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const tpl = process.env.WEB_FETCH_API!
    validate(tpl)
    const fetchUrl = tpl.replace(/\{url\}/g, encodeURIComponent(url))
    const timeout = (Number(process.env.WEB_FETCH_CUSTOM_TIMEOUT_SEC) || TIMEOUT) * 1000
    const h: Record<string, string> = {}
    const key = process.env.WEB_FETCH_API_KEY
    if (key) h[process.env.WEB_FETCH_API_AUTH_HEADER ?? 'Authorization'] = `${process.env.WEB_FETCH_API_AUTH_SCHEME ?? 'Bearer'} ${key}`.trim()
    const extra = process.env.WEB_FETCH_API_HEADERS
    if (extra) for (const p of extra.split(';')) { const i = p.indexOf(':'); if (i > 0) h[p.slice(0,i).trim()] = p.slice(i+1).trim() }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    try {
      const r = await fetch(fetchUrl, { headers: h, signal: ctrl.signal })
      clearTimeout(timer)
      if (!r.ok) throw new Error(`Custom fetch ${r.status}: ${r.statusText}`)
      const content = await r.text()
      return { content, bytes: Buffer.byteLength(content), code: r.status, codeText: r.statusText, contentType: r.headers.get('content-type') ?? 'text/plain' }
    } catch (err) { clearTimeout(timer); throw err }
  },
}
