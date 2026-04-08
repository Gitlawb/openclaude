/** Linkup — uses Linkup search API, extracts snippets. LINKUP_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const linkupProvider: FetchProvider = {
  name: 'linkup',
  isConfigured() { return Boolean(process.env.LINKUP_API_KEY) },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    const r = await fetch('https://api.linkup.so/v1/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINKUP_API_KEY}` },
      body: JSON.stringify({ q: `site:${new URL(url).hostname} ${new URL(url).pathname}`, search_type: 'standard' }), signal,
    })
    if (!r.ok) throw new Error(`Linkup error ${r.status}: ${await r.text().catch(() => '')}`)
    const data = await r.json()
    const results = data.results ?? []
    const content = results.map((w: { name?: string; title?: string; snippet?: string; description?: string; url: string }) =>
      `### ${w.name ?? w.title ?? ''}\n${w.snippet ?? w.description ?? ''}\n${w.url}`
    ).join('\n\n')
    return { content: content || 'No results found', bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
