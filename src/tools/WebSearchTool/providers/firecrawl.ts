import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const firecrawlProvider: SearchProvider = {
  name: 'firecrawl',

  isConfigured() {
    return Boolean(process.env.FIRECRAWL_API_KEY)
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()
    const { FirecrawlClient } = await import('@mendable/firecrawl-js')
    const app = new FirecrawlClient({ apiKey: process.env.FIRECRAWL_API_KEY! })

    let query = input.query
    if (input.blocked_domains?.length) {
      const exclusions = input.blocked_domains.map(d => `-site:${d}`).join(' ')
      query = `${query} ${exclusions}`
    }

    const data = await app.search(query, { limit: 10 })

    const hits = applyDomainFilters(
      (data.web ?? []).map((r: { url: string; title?: string; description?: string }) => ({
        title: r.title ?? r.url,
        url: r.url,
        description: r.description,
      })),
      input,
    )

    return {
      hits,
      providerName: 'firecrawl',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
