/**
 * Provider registry and selection logic.
 *
 * WEB_SEARCH_PROVIDER controls which backend to use:
 *
 *   "auto"     (default) — try providers in priority order, fall through on failure
 *   "custom"   — use WEB_SEARCH_API / WEB_PROVIDER preset only (fail loudly)
 *   "firecrawl" — use Firecrawl only (fail loudly)
 *   "ddg"      — use DuckDuckGo only (fail loudly)
 *   "native"   — use Anthropic native / Codex only (fail loudly)
 *
 * "auto" mode is the only mode that silently falls through to the next provider.
 * All other modes throw on failure — no silent backend switching.
 */

import type { SearchInput, SearchProvider } from './types.js'
import type { ProviderOutput } from './types.js'

import { customProvider } from './custom.js'
import { duckduckgoProvider } from './duckduckgo.js'
import { firecrawlProvider } from './firecrawl.js'

export { type SearchInput, type SearchProvider, type ProviderOutput, type SearchHit } from './types.js'
export { applyDomainFilters } from './types.js'

// ---------------------------------------------------------------------------
// All registered providers
// ---------------------------------------------------------------------------

const ALL_PROVIDERS: SearchProvider[] = [
  customProvider,
  firecrawlProvider,
  duckduckgoProvider,
]

export function getAvailableProviders(): SearchProvider[] {
  return ALL_PROVIDERS.filter(p => p.isConfigured())
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type ProviderMode = 'auto' | 'custom' | 'firecrawl' | 'ddg' | 'native'

const PROVIDER_BY_NAME: Record<string, SearchProvider> = {
  custom: customProvider,
  firecrawl: firecrawlProvider,
  ddg: duckduckgoProvider,
}

export function getProviderMode(): ProviderMode {
  const raw = process.env.WEB_SEARCH_PROVIDER ?? 'auto'
  if (raw === 'auto' || raw === 'custom' || raw === 'firecrawl' || raw === 'ddg' || raw === 'native') {
    return raw
  }
  return 'auto'
}

/**
 * Returns the list of providers to try, in order.
 *
 * - Specific mode → single provider
 * - Auto → priority order: custom → firecrawl → ddg
 */
export function getProviderChain(mode: ProviderMode): SearchProvider[] {
  if (mode === 'auto') {
    return ALL_PROVIDERS.filter(p => p.isConfigured())
  }
  if (mode === 'native') {
    return [] // native Anthropic/Codex handled outside the adapter system
  }
  const provider = PROVIDER_BY_NAME[mode]
  if (!provider) return []
  return [provider]
}

/**
 * Run a search using the configured provider chain.
 *
 * - Auto mode: tries each provider in order, falls through on failure.
 *   If ALL providers fail, throws the last error.
 * - Specific mode: runs the single provider, throws immediately on failure.
 */
export async function runSearch(
  input: SearchInput,
  signal?: AbortSignal,
): Promise<ProviderOutput> {
  const mode = getProviderMode()
  const chain = getProviderChain(mode)

  if (chain.length === 0) {
    throw new Error(
      mode === 'native'
        ? 'Native web search requires firstParty/vertex/foundry provider.'
        : `No search providers available. Set WEB_SEARCH_API or FIRECRAWL_API_KEY.`,
    )
  }

  const errors: Error[] = []

  for (const provider of chain) {
    try {
      return await provider.search(input, signal)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      errors.push(error)

      // Specific mode: fail loudly, no fallback
      if (mode !== 'auto') {
        throw error
      }

      // Auto mode: log and try next
      // (importing logError would create a cycle, so we use console.error here —
      //  the caller can also log via their own logError)
      console.error(`[web-search] ${provider.name} failed: ${error.message}`)
    }
  }

  // All providers failed in auto mode
  const lastErr = errors[errors.length - 1]
  throw lastErr ?? new Error('All search providers failed with no error details.')
}
