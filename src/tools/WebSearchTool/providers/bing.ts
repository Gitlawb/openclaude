/**
 * Bing Web Search API adapter.
 * GET https://api.bing.microsoft.com/v7.0/search?q=...
 * Auth: Ocp-Apim-Subscription-Key: <key>
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const bingProvider: SearchProvider = {
  name: 'bing',

  isConfigured() {
    return Boolean(process.env.BING_API_KEY)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()

    const url = new URL('https://api.bing.microsoft.com/v7.0/search')
    url.searchParams.set('q', input.query)
    url.searchParams.set('count', '10')

    const res = await fetch(url.toString(), {
      headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_API_KEY! },
      signal,
    })

    if (!res.ok) {
      throw new Error(`Bing search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const hits = (data.webPages?.value ?? []).map((r: any) => ({
      title: r.name ?? '',
      url: r.url ?? '',
      description: r.snippet,
      source: r.displayUrl,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'bing',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
