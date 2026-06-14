import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'
import { crwSearch } from '../../crw/client.js'

// fastCRW: Firecrawl-compatible web scraper; single binary; self-host or cloud.
export const crwProvider: SearchProvider = {
  name: 'crw',

  isConfigured() {
    return Boolean(process.env.CRW_API_KEY) || Boolean(process.env.CRW_API_URL)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    let query = input.query
    if (input.blocked_domains?.length) {
      const exclusions = input.blocked_domains.map(d => `-site:${d}`).join(' ')
      query = `${query} ${exclusions}`
    }

    const data = await crwSearch(query, {
      apiKey: process.env.CRW_API_KEY,
      apiUrl: process.env.CRW_API_URL,
      limit: 15,
      signal,
    })

    const hits = applyDomainFilters(
      (data ?? []).map(r => ({
        title: r.title ?? r.url,
        url: r.url,
        description: r.description,
      })),
      input,
    )

    return {
      hits,
      providerName: 'crw',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
