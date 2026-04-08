/** Bing — uses Bing Web Search API, extracts snippets as content. BING_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const bingProvider: FetchProvider = {
  name: 'bing',
  isConfigured() { return Boolean(process.env.BING_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const u = new URL('https://api.bing.microsoft.com/v7.0/search')
    u.searchParams.set('q', `site:${new URL(url).hostname} ${new URL(url).pathname}`)
    u.searchParams.set('count', '5')
    const r = await fetch(u.toString(), { headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_API_KEY! }, signal })
    if (!r.ok) throw new Error(`Bing error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const pages = data.webPages?.value ?? []
    const content = pages.map((p: { name: string; snippet: string; url: string }) => `### ${p.name}\n${p.snippet}\n${p.url}`).join('\n\n')
    return { content: content || 'No results found', bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
