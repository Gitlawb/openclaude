/**
 * Firecrawl WebFetch provider.
 *
 * Uses the Firecrawl SDK to scrape URLs. Firecrawl handles JavaScript
 * rendering, anti-bot detection, and content extraction automatically.
 * Returns clean markdown content.
 *
 * Auth: FIRECRAWL_API_KEY
 */

import type { FetchProvider, FetchResult, RedirectInfo } from './types.js'

export const firecrawlProvider: FetchProvider = {
  name: 'firecrawl',

  isConfigured() {
    return Boolean(process.env.FIRECRAWL_API_KEY)
  },

  async fetch(url: string): Promise<FetchResult | RedirectInfo> {
    const { FirecrawlClient } = await import('@mendable/firecrawl-js')
    const app = new FirecrawlClient({ apiKey: process.env.FIRECRAWL_API_KEY! })
    const result = await app.scrape(url, { formats: ['markdown'] })
    const markdown = (result as { markdown?: string }).markdown ?? ''

    return {
      content: markdown,
      bytes: Buffer.byteLength(markdown),
      code: 200,
      codeText: 'OK',
      contentType: 'text/markdown',
    }
  },
}
