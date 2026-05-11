/**
 * Exa Search API adapter.
 * POST https://api.exa.ai/search
 * Auth: x-api-key: <key>
 *
 * Canonical reference:
 *   https://docs.exa.ai/reference/search-api-guide-for-coding-agents
 *
 * We request `contents.highlights: true` because the Exa docs explicitly
 * recommend highlights for agent workflows (10x fewer tokens than full text,
 * with the most query-relevant excerpts). Without `contents`, Exa returns
 * results with no excerpts at all — descriptions would be empty for every hit.
 *
 * Response shape (relevant fields):
 *   results[].title           string
 *   results[].url             string
 *   results[].highlights      string[]   (when contents.highlights requested)
 *   results[].highlightScores number[]   (cosine similarity per highlight)
 *   results[].text            string     (only when contents.text requested)
 */

import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, safeHostname, type ProviderOutput } from './types.js'

/** Join up to 3 highlight excerpts with an ellipsis separator. */
function describeFromHighlights(r: any): string | undefined {
  const highlights = Array.isArray(r?.highlights) ? r.highlights : null
  if (highlights && highlights.length > 0) {
    return highlights.slice(0, 3).join(' … ')
  }
  if (typeof r?.text === 'string' && r.text) return r.text
  return undefined
}

export const exaProvider: SearchProvider = {
  name: 'exa',

  isConfigured() {
    return Boolean(process.env.EXA_API_KEY)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()

    const body: Record<string, any> = {
      query: input.query,
      numResults: 15,
      type: 'auto',
      contents: { highlights: true },
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
      signal,
    })

    if (!res.ok) {
      throw new Error(`Exa search error ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const hits = (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: describeFromHighlights(r),
      source: r.url ? safeHostname(r.url) : undefined,
    }))

    return {
      // Exa handles domain filtering server-side via includeDomains/excludeDomains
      hits,
      providerName: 'exa',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
