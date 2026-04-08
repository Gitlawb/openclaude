/** You.com — uses You.com search API, extracts snippets. YOU_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const youProvider: FetchProvider = {
  name: 'you',
  isConfigured() { return Boolean(process.env.YOU_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const u = new URL('https://api.ydc-index.io/v1/search')
    u.searchParams.set('query', `site:${new URL(url).hostname}`)
    const r = await fetch(u.toString(), { headers: { 'X-API-Key': process.env.YOU_API_KEY! }, signal })
    if (!r.ok) throw new Error(`You.com error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const web = data?.results?.web ?? data?.results ?? []
    const content = web.map((w: { title: string; snippets?: string[]; description?: string; url: string }) => {
      const snip = Array.isArray(w.snippets) ? w.snippets[0] : w.snippet ?? w.description ?? ''
      return `### ${w.title}\n${snip}\n${w.url}`
    }).join('\n\n')
    return { content: content || 'No results found', bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
