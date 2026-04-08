/**
 * WebFetch provider registry and selection.
 *
 * WEB_FETCH_PROVIDER controls which backend to use:
 *   auto | default | firecrawl | tavily | exa | jina | jina-reader
 *   | bing | brave | you | mojeek | linkup | ddg | custom
 *
 * Auto mode priority: firecrawl → tavily → exa → jina → jina-reader → bing
 *   → brave → you → mojeek → linkup → ddg → default
 *
 * Custom is excluded from auto chain (must be explicitly selected).
 */

import type { FetchProvider, FetchResult, ProviderMode, RedirectInfo } from './types.js'
import { defaultProvider } from './default.js'
import { firecrawlProvider } from './firecrawl.js'
import { tavilyProvider } from './tavily.js'
import { exaProvider } from './exa.js'
import { jinaProvider } from './jina.js'
import { jinaReaderProvider } from './jina-reader.js'
import { bingProvider } from './bing.js'
import { braveProvider } from './brave.js'
import { youProvider } from './you.js'
import { mojeekProvider } from './mojeek.js'
import { linkupProvider } from './linkup.js'
import { ddgProvider } from './ddg.js'
import { customProvider } from './custom.js'

export { type FetchProvider, type FetchResult, type RedirectInfo, type ProviderMode } from './types.js'

const ALL_PROVIDERS: FetchProvider[] = [
  firecrawlProvider, tavilyProvider, exaProvider, jinaProvider,
  jinaReaderProvider, bingProvider, braveProvider, youProvider,
  mojeekProvider, linkupProvider, ddgProvider, defaultProvider,
]

const PROVIDER_BY_NAME: Record<string, FetchProvider> = {
  default: defaultProvider, firecrawl: firecrawlProvider, tavily: tavilyProvider,
  exa: exaProvider, jina: jinaProvider, 'jina-reader': jinaReaderProvider,
  bing: bingProvider, brave: braveProvider, you: youProvider,
  mojeek: mojeekProvider, linkup: linkupProvider, ddg: ddgProvider,
  custom: customProvider,
}

const VALID = new Set<string>([...Object.keys(PROVIDER_BY_NAME), 'auto'])

export function getProviderMode(): ProviderMode {
  const raw = process.env.WEB_FETCH_PROVIDER ?? 'auto'
  return (VALID.has(raw) ? raw : 'auto') as ProviderMode
}

export function getAvailableProviders(): FetchProvider[] {
  return ALL_PROVIDERS.filter(p => p.isConfigured())
}

function getChain(mode: ProviderMode): FetchProvider[] {
  if (mode === 'auto') return ALL_PROVIDERS.filter(p => p.isConfigured())
  const p = PROVIDER_BY_NAME[mode]
  return p ? [p] : []
}

export async function runFetch(url: string, signal?: AbortSignal): Promise<FetchResult | RedirectInfo> {
  const mode = getProviderMode()
  const chain = getChain(mode)
  if (chain.length === 0) throw new Error(`No fetch providers for mode "${mode}". Check env vars.`)

  if (mode !== 'auto' && mode !== 'custom') {
    const p = chain[0]
    if (p && !p.isConfigured()) throw new Error(`Provider "${mode}" not configured. Set the required env var.`)
  }

  const errors: Error[] = []
  for (const provider of chain) {
    try { return await provider.fetch(url, signal) }
    catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      if (e.name === 'AbortError' || signal?.aborted) throw e
      errors.push(e)
      if (mode !== 'auto') throw e
      console.error(`[web-fetch] ${provider.name} failed: ${e.message}`)
    }
  }

  const last = errors[errors.length - 1]
  if (!last) throw new Error('All fetch providers failed with no details.')
  if (errors.length === 1) throw last
  throw new Error(`All ${errors.length} fetch providers failed:\n${errors.map((e, i) => `  ${i + 1}. ${e.message}`).join('\n')}`)
}
