import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput } from './types.js'

// DuckDuckGo's HTML scraper aggressively blocks datacenter / repeat IPs with
// an "anomaly in the request" response. When that happens we surface an
// actionable error instead of the opaque scraper message so users know how
// to configure a working backend.
const DDG_ANOMALY_HINT =
  'DuckDuckGo scraping is rate-limited from this network. ' +
  'Configure a search backend with one of: ' +
  'FIRECRAWL_API_KEY, TAVILY_API_KEY, EXA_API_KEY, YOU_API_KEY, ' +
  'JINA_API_KEY, BING_API_KEY, MOJEEK_API_KEY, LINKUP_API_KEY — ' +
  'or use an Anthropic / Vertex / Foundry provider for native web search.'

function isAnomalyError(message: string): boolean {
  return /anomaly in the request|likely making requests too quickly/i.test(
    message,
  )
}

export const duckduckgoProvider: SearchProvider = {
  name: 'duckduckgo',

  isConfigured() {
    // DDG is the default fallback — always available (duck-duck-scrape is a runtime dep)
    return true
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    let search: typeof import('duck-duck-scrape').search
    let SafeSearchType: typeof import('duck-duck-scrape').SafeSearchType
    try {
      ;({ search, SafeSearchType } = await import('duck-duck-scrape'))
    } catch {
      throw new Error('duck-duck-scrape package not installed. Run: npm install duck-duck-scrape')
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // TODO: duck-duck-scrape doesn't accept AbortSignal — can't cancel in-flight searches
    let response: Awaited<ReturnType<typeof search>>
    try {
      response = await search(input.query, { safeSearch: SafeSearchType.STRICT })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isAnomalyError(msg)) {
        throw new Error(DDG_ANOMALY_HINT)
      }
      throw err
    }

    const hits = applyDomainFilters(
      response.results.map(r => ({
        title: r.title || r.url,
        url: r.url,
        description: r.description ?? undefined,
      })),
      input,
    )

    return {
      hits,
      providerName: 'duckduckgo',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
