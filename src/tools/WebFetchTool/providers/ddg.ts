/** DuckDuckGo — uses duck-duck-scrape for instant answers. Always available. */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const ddgProvider: FetchProvider = {
  name: 'ddg',
  isConfigured() { return true },
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
    let search: typeof import('duck-duck-scrape').search
    try { ({ search } = await import('duck-duck-scrape')) } catch { throw new Error('duck-duck-scrape not installed') }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const resp = await search(`site:${new URL(url).hostname} ${new URL(url).pathname}`, { safeSearch: 0 })
    const content = (resp.results ?? []).slice(0, 5).map(r => `### ${r.title}\n${r.description ?? ''}\n${r.url}`).join('\n\n')
    return { content: content || 'No results found', bytes: Buffer.byteLength(content), code: 200, codeText: 'OK', contentType: 'text/plain' }
  },
}
