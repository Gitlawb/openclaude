/** Jina Reader — free URL→markdown. JINA_API_KEY optional */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const jinaProvider: FetchProvider = {
  name: 'jina',
  isConfigured() { return true },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const h: Record<string, string> = { Accept: 'text/plain' }
    if (process.env.JINA_API_KEY) h['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: h, signal })
    if (!r.ok) throw new Error(`Jina error ${r.status}: ${await r.text().catch(() => '')}`)
    const content = await r.text()
    return { content, bytes: Buffer.byteLength(content), code: r.status, codeText: r.statusText, contentType: r.headers.get('content-type') ?? 'text/markdown' }
  },
}
