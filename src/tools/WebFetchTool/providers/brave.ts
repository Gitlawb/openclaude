/** Brave — uses Brave Search API, extracts snippets. WEB_KEY + WEB_PROVIDER=brave */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const braveProvider: FetchProvider = {
  name: 'brave',
  isConfigured() { return Boolean(process.env.WEB_KEY) && process.env.WEB_PROVIDER === 'brave' },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const u = new URL('https://api.search.brave.com/res/v1/web/search')
    u.searchParams.set('q', `site:${new URL(url).hostname} ${new URL(url).pathname}`)
    u.searchParams.set('count', '5')
    const r = await fetch(u.toString(), { headers: { 'X-Subscription-Token': process.env.WEB_KEY! }, signal })
    if (!r.ok) throw new Error(`Brave error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const results = data.web?.results ?? []
    const content = results.map((w: { title: string; description: string; url: string }) => `### ${w.title}\n${w.description}\n${w.url}`).join('\n\n')
    return { content: content || 'No results found', bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
