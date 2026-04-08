/**
 * Exa Search API adapter.
 * POST https://api.exa.ai/search
 * Auth: x-api-key: <key>
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

export const exaProvider: SearchProvider = {
  name: 'exa',

  isConfigured() {
    return Boolean(process.env.EXA_API_KEY)
  },

  async search(input: SearchInput): Promise<ProviderOutput> {
    const start = performance.now()

    const body: Record<string, any> = {
      query: input.query,
      numResults: 10,
      type: 'auto',
    }

    if (input.allowed_domains?.length) body.includeDomains = input.allowed_domains
    if (input.blocked_domains?.length) body.excludeDomains = input.blocked_domains

    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXA_API_KEY!,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`Exa search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const hits = (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.snippet ?? r.text,
      source: r.url ? new URL(r.url).hostname : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'exa',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
