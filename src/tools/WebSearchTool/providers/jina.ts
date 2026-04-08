/**
 * Jina Search API adapter.
 * GET https://s.jina.ai/?q=...
 * Auth: Authorization: Bearer <key>
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const jinaProvider: SearchProvider = {
  name: 'jina',

  isConfigured() {
    return Boolean(process.env.JINA_API_KEY)
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()

    const url = new URL('https://s.jina.ai/')
    url.searchParams.set('q', input.query)

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.JINA_API_KEY}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(`Jina search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const hits = (data.data ?? data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description ?? r.snippet ?? r.content,
      source: r.url ? new URL(r.url).hostname : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'jina',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
