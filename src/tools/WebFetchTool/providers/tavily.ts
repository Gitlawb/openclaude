/** Tavily Extract — AI-optimized content extraction. TAVILY_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const tavilyProvider: FetchProvider = {
  name: 'tavily',
  isConfigured() { return Boolean(process.env.TAVILY_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const r = await fetch('https://api.tavily.com/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ urls: [url] }), signal,
    })
    if (!r.ok) throw new Error(`Tavily extract error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const content = data.results?.[0]?.raw_content ?? data.results?.[0]?.content ?? ''
    return { content, bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
