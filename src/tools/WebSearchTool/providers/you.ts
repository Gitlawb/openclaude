/**
 * You.com Search API adapter.
 * GET https://api.ydc-index.io/v1/search?query=...
 * Auth: X-API-Key: <key>
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, safeHostname, type ProviderOutput } from './types.js'

export const youProvider: SearchProvider = {
  name: 'you',

  isConfigured() {
    return Boolean(process.env.YOU_API_KEY)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()

    const url = new URL('https://api.ydc-index.io/v1/search')
    url.searchParams.set('query', input.query)

    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': process.env.YOU_API_KEY! },
      signal,
    })

    if (!res.ok) {
      throw new Error(`You.com search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const webResults = data?.results?.web ?? data?.results ?? []

    const hits = webResults.map((r: any) => {
      const snippet = Array.isArray(r.snippets) ? r.snippets[0] : r.snippet
      return {
        title: r.title ?? '',
        url: r.url ?? '',
        description: snippet ?? r.description,
        source: r.url ? safeHostname(r.url) : undefined,
      }
    })

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'you',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
