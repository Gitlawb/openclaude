/** Mojeek — uses Mojeek search API, extracts snippets. MOJEEK_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const mojeekProvider: FetchProvider = {
  name: 'mojeek',
  isConfigured() { return Boolean(process.env.MOJEEK_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const u = new URL('https://www.mojeek.com/search')
    u.searchParams.set('q', `site:${new URL(url).hostname} ${new URL(url).pathname}`)
    u.searchParams.set('fmt', 'json')
    const r = await fetch(u.toString(), { headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.MOJEEK_API_KEY}` }, signal })
    if (!r.ok) throw new Error(`Mojeek error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const results = data?.response?.results ?? data?.results ?? []
    const content = results.map((w: { title: string; snippet: string; url: string }) => `### ${w.title}\n${w.snippet}\n${w.url}`).join('\n\n')
    return { content: content || 'No results found', bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
