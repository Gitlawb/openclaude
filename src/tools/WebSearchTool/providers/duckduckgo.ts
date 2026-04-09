import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const duckduckgoProvider: SearchProvider = {
  name: 'duckduckgo',

  isConfigured() {
    // DDG is the default fallback — always available (duck-duck-scrape is a runtime dep)
    return true
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    let search: typeof import('duck-duck-scrape').search
    try {
      ;({ search } = await import('duck-duck-scrape'))
    } catch {
      throw new Error('duck-duck-scrape package not installed. Run: npm install duck-duck-scrape')
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // TODO: duck-duck-scrape doesn't accept AbortSignal — can't cancel in-flight searches
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
