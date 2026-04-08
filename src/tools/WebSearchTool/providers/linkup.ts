/**
 * Linkup Search API adapter.
 * POST https://api.linkup.so/v1/search
 * Auth: Authorization: Bearer <key>
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const linkupProvider: SearchProvider = {
  name: 'linkup',

  isConfigured() {
    return Boolean(process.env.LINKUP_API_KEY)
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()

    const res = await fetch('https://api.linkup.so/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINKUP_API_KEY}`,
      },
      body: JSON.stringify({
        q: input.query,
        search_type: 'standard',
      }),
    })

    if (!res.ok) {
      throw new Error(`Linkup search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const hits = (data.results ?? []).map((r: any) => ({
      title: r.name ?? r.title ?? '',
      url: r.url ?? '',
      description: r.snippet ?? r.description ?? r.content,
      source: r.url ? new URL(r.url).hostname : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'linkup',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
