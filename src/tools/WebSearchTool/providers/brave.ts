/**
 * Brave Search API adapter.
 * GET https://api.search.brave.com/res/v1/web/search?q=...
 * Auth: X-Subscription-Token: <key>   (bare token — no "Bearer" prefix)
 *
 * Brave runs an independent web index (~30B pages) — useful as a non-Google,
 * non-Bing fallback in the auto chain.
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, safeHostname, type ProviderOutput } from './types.js'

export const braveProvider: SearchProvider = {
  name: 'brave',

  isConfigured() {
    return Boolean(process.env.BRAVE_API_KEY)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()

    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', input.query)
    url.searchParams.set('count', '15')

    const res = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': process.env.BRAVE_API_KEY!,
        Accept: 'application/json',
      },
      signal,
    })

    if (!res.ok) {
      throw new Error(`Brave search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const hits = (data.web?.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description,
      source: r.url ? safeHostname(r.url) : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'brave',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
