/**
 * Tavily Search API adapter.
 * POST https://api.tavily.com/search
 * Auth: Authorization: Bearer tvly-xxxx
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const tavilyProvider: SearchProvider = {
  name: 'tavily',

  isConfigured() {
    return Boolean(process.env.TAVILY_API_KEY)
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: input.query,
        max_results: 10,
        include_answer: false,
      }),
    })

    if (!res.ok) {
      throw new Error(`Tavily search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()

    const hits = (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.content ?? r.snippet,
      source: r.url ? new URL(r.url).hostname : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'tavily',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
