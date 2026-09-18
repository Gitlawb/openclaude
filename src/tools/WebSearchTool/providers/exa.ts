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
import { fetchJsonWithWebSearchTimeout } from './timeout.js'

/** Join up to 3 highlight excerpts with an ellipsis separator. */
function describeFromHighlights(r: unknown): string | undefined {
  if (!r || typeof r !== 'object') return undefined
  const rec = r as Record<string, unknown>
  const highlights = Array.isArray(rec.highlights) ? rec.highlights : null
  if (highlights && highlights.length > 0) {
    return (highlights as unknown[]).slice(0, 3).filter((s): s is string => typeof s === 'string').join(' … ')
  }
  if (typeof rec.text === 'string' && rec.text) return rec.text
  return undefined
}

export const exaProvider: SearchProvider = {
  name: 'exa',

  isConfigured() {
    return Boolean(process.env.EXA_API_KEY)
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()

    const body: Record<string, unknown> = {
      query: input.query,
      numResults: 15,
      type: 'auto',
      contents: { highlights: true },
    }

    if (input.allowed_domains?.length) body.includeDomains = input.allowed_domains
    if (input.blocked_domains?.length) body.excludeDomains = input.blocked_domains

    const data = (await fetchJsonWithWebSearchTimeout(
      'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.EXA_API_KEY!,
        },
        body: JSON.stringify(body),
      },
      signal,
      { providerName: 'Exa' },
    )) as { results?: unknown }

    const results = Array.isArray(data.results) ? data.results : []
    const hits = (results as unknown[]).map((r): {
      title: string
      url: string
      description: string | undefined
      source: string | undefined
    } => {
      const rec = (r ?? {}) as Record<string, unknown>
      const url = typeof rec.url === 'string' ? rec.url : ''
      return {
        title: typeof rec.title === 'string' ? rec.title : '',
        url,
        description: describeFromHighlights(r),
        source: url ? safeHostname(url) : undefined,
      }
    })

    return {
      // Exa handles domain filtering server-side via includeDomains/excludeDomains
      hits,
      providerName: 'exa',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
