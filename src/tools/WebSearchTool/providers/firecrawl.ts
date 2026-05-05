import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'
import { firecrawlSearch } from '../../firecrawl/client.js'

export const firecrawlProvider: SearchProvider = {
  name: 'firecrawl',

  isConfigured() {
    return Boolean(process.env.FIRECRAWL_API_KEY) || Boolean(process.env.FIRECRAWL_API_URL)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    let query = input.query
    if (input.blocked_domains?.length) {
      const exclusions = input.blocked_domains.map(d => `-site:${d}`).join(' ')
      query = `${query} ${exclusions}`
    }

    const data = await firecrawlSearch(query, {
      apiKey: process.env.FIRECRAWL_API_KEY,
      apiUrl: process.env.FIRECRAWL_API_URL,
      limit: 15,
      signal,
    })

    const hits = applyDomainFilters(
      (data.web ?? []).map(r => ({
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
