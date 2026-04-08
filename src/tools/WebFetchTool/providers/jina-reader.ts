/** Jina Reader Pro — structured JSON output. JINA_API_KEY required */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const jinaReaderProvider: FetchProvider = {
  name: 'jina-reader',
  isConfigured() { return Boolean(process.env.JINA_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const u = new URL('https://s.jina.ai/')
    u.searchParams.set('q', url)
    u.searchParams.set('format', 'json')
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}`, Accept: 'application/json' }, signal })
    if (!r.ok) throw new Error(`Jina Reader Pro error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const content = data.data?.[0]?.content ?? data.data?.[0]?.text ?? data.content ?? ''
    return { content, bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/markdown' }
  },
}
