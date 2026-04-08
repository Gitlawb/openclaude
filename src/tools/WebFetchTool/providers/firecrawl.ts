/** Firecrawl — JS rendering, anti-bot. FIRECRAWL_API_KEY */
import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'
export const firecrawlProvider: FetchProvider = {
  name: 'firecrawl',
  isConfigured() { return Boolean(process.env.FIRECRAWL_API_KEY) },
  async fetch(url: string): Promise<FetchResult | RedirectInfo> {
    const { FirecrawlClient } = await import('@mendable/firecrawl-js')
    const r = await new FirecrawlClient({ apiKey: process.env.FIRECRAWL_API_KEY! }).scrape(url, { formats: ['markdown'] })
    const md = (r as { markdown?: string }).markdown ?? ''
    return { content: md, bytes: Buffer.byteLength(md), code: 200, codeText: 'OK', contentType: 'text/markdown' }
  },
}
