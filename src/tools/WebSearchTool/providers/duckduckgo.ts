import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const duckduckgoProvider: SearchProvider = {
  name: 'duckduckgo',

  isConfigured() {
    // DDG is the default fallback for non-Claude models — always available
    return true
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()
    const { search } = await import('duck-duck-scrape')
    const response = await search(input.query, { safeSearch: 0 })

    const hits = applyDomainFilters(
      response.results.map(r => ({
        title: r.title || r.url,
        url: r.url,
        description: r.description ?? undefined,
      })),
      input,
    )

    return {
      hits,
      providerName: 'duckduckgo',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
