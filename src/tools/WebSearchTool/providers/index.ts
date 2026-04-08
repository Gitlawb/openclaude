/**
 * Provider registry and selection logic.
 *
 * WEB_SEARCH_PROVIDER controls which backend to use:
 *
 *   "auto"      (default) — try providers in priority order, fall through on failure
 *   "custom"    — use WEB_SEARCH_API / WEB_PROVIDER preset only (fail loudly)
 *   "firecrawl" — use Firecrawl only (fail loudly)
 *   "tavily"    — use Tavily only (fail loudly)
 *   "exa"       — use Exa only (fail loudly)
 *   "you"       — use You.com only (fail loudly)
 *   "jina"      — use Jina only (fail loudly)
 *   "bing"      — use Bing only (fail loudly)
 *   "mojeek"    — use Mojeek only (fail loudly)
 *   "linkup"    — use Linkup only (fail loudly)
 *   "ddg"       — use DuckDuckGo only (fail loudly)
 *   "native"    — use Anthropic native / Codex only (fail loudly)
 *
 * "auto" mode is the only mode that silently falls through to the next provider.
 * All other modes throw on failure — no silent backend switching.
 */

import type { SearchInput, SearchProvider } from './types.js'
import type { ProviderOutput } from './types.js'

import { customProvider } from './custom.js'
import { duckduckgoProvider } from './duckduckgo.js'
import { firecrawlProvider } from './firecrawl.js'
import { tavilyProvider } from './tavily.js'
import { exaProvider } from './exa.js'
import { youProvider } from './you.js'
import { jinaProvider } from './jina.js'
import { bingProvider } from './bing.js'
import { mojeekProvider } from './mojeek.js'
import { linkupProvider } from './linkup.js'

export { type SearchInput, type SearchProvider, type ProviderOutput, type SearchHit } from './types.js'
export { applyDomainFilters, safeHostname } from './types.js'
export { extractHits } from './custom.js'

// ---------------------------------------------------------------------------
// All registered providers — order matters for auto mode
// ---------------------------------------------------------------------------
// Priority: custom → firecrawl → tavily → exa → you → jina → bing → mojeek
//           → linkup → ddg
// DDG is last because it's free but rate-limited.

const ALL_PROVIDERS: SearchProvider[] = [
  customProvider,
  firecrawlProvider,
  tavilyProvider,
  exaProvider,
  youProvider,
  jinaProvider,
  bingProvider,
  mojeekProvider,
  linkupProvider,
  duckduckgoProvider,
]

export function getAvailableProviders(): SearchProvider[] {
  return ALL_PROVIDERS.filter(p => p.isConfigured())
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type ProviderMode =
  | 'auto'
  | 'custom'
  | 'firecrawl'
  | 'ddg'
  | 'tavily'
  | 'exa'
  | 'you'
  | 'jina'
  | 'bing'
  | 'mojeek'
  | 'linkup'
  | 'native'

const PROVIDER_BY_NAME: Record<string, SearchProvider> = {
  custom: customProvider,
  firecrawl: firecrawlProvider,
  ddg: duckduckgoProvider,
  tavily: tavilyProvider,
  exa: exaProvider,
  you: youProvider,
  jina: jinaProvider,
  bing: bingProvider,
  mojeek: mojeekProvider,
  linkup: linkupProvider,
}

const VALID_MODES = new Set<string>(Object.keys(PROVIDER_BY_NAME).concat(['auto', 'native']))

export function getProviderMode(): ProviderMode {
  const raw = process.env.WEB_SEARCH_PROVIDER ?? 'auto'
  if (VALID_MODES.has(raw)) return raw as ProviderMode
  return 'auto'
}

/**
 * Returns the list of providers to try, in order.
 * - Specific mode → single provider
 * - Auto → priority order (ALL_PROVIDERS, filtered by isConfigured)
 */
export function getProviderChain(mode: ProviderMode): SearchProvider[] {
  if (mode === 'auto') {
    return ALL_PROVIDERS.filter(p => p.isConfigured())
  }
  if (mode === 'native') {
    return []
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
        : `No search providers available for mode "${mode}". Check your env vars.`,
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
      console.error(`[web-search] ${provider.name} failed: ${error.message}`)
    }
  }

  // All providers failed in auto mode
  const lastErr = errors[errors.length - 1]
  if (!lastErr) throw new Error('All search providers failed with no error details.')
  if (errors.length === 1) throw lastErr
  throw new Error(
    `All ${errors.length} search providers failed:\n` +
    errors.map((e, i) => `  ${i + 1}. ${e.message}`).join('\n'),
  )
}
