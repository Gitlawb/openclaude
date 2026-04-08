/**
 * WebFetch provider registry and selection logic.
 *
 * WEB_FETCH_PROVIDER controls which backend to use:
 *
 *   "auto"     (default) — try providers in priority order, fall through on failure
 *   "default"  — direct HTTP fetch via axios (always available)
 *   "firecrawl" — Firecrawl SDK (JS rendering, anti-bot)
 *   "jina"     — Jina Reader API (free, clean markdown)
 *   "custom"   — user-configured HTTP endpoint
 *
 * "auto" mode is the only mode that silently falls through to the next provider.
 * All other modes throw on failure — no silent backend switching.
 *
 * Auto mode priority: firecrawl → jina → default
 */

import type { FetchProvider, FetchResult, ProviderMode, RedirectInfo } from './types.js'
import { defaultProvider } from './default.js'
import { firecrawlProvider } from './firecrawl.js'
import { jinaProvider } from './jina.js'
import { customProvider } from './custom.js'

export { type FetchProvider, type FetchResult, type RedirectInfo, type ProviderMode } from './types.js'

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

// Priority order for auto mode: premium providers first, default last
const ALL_PROVIDERS: FetchProvider[] = [
  firecrawlProvider,
  jinaProvider,
  defaultProvider,
]

const PROVIDER_BY_NAME: Record<string, FetchProvider> = {
  default: defaultProvider,
  firecrawl: firecrawlProvider,
  jina: jinaProvider,
  custom: customProvider,
}

const VALID_MODES = new Set<string>([...Object.keys(PROVIDER_BY_NAME), 'auto'])

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function getProviderMode(): ProviderMode {
  const raw = process.env.WEB_FETCH_PROVIDER ?? 'auto'
  if (VALID_MODES.has(raw)) return raw as ProviderMode
  return 'auto'
}

export function getAvailableProviders(): FetchProvider[] {
  return ALL_PROVIDERS.filter(p => p.isConfigured())
}

function getProviderChain(mode: ProviderMode): FetchProvider[] {
  if (mode === 'auto') {
    return ALL_PROVIDERS.filter(p => p.isConfigured())
  }
  const provider = PROVIDER_BY_NAME[mode]
  if (!provider) return []
  return [provider]
}

// ---------------------------------------------------------------------------
// Run fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a URL using the configured provider chain.
 *
 * - Auto mode: tries each provider in order, falls through on failure.
 *   If ALL providers fail, throws the last error.
 * - Specific mode: runs the single provider, throws immediately on failure.
 */
export async function runFetch(
  url: string,
  signal?: AbortSignal,
): Promise<FetchResult | RedirectInfo> {
  const mode = getProviderMode()
  const chain = getProviderChain(mode)

  if (chain.length === 0) {
    throw new Error(
      `No fetch providers available for mode "${mode}". Check your env vars.`,
    )
  }

  // Explicit provider mode: fail fast if not configured
  if (mode !== 'auto') {
    const provider = chain[0]
    if (provider && !provider.isConfigured()) {
      throw new Error(
        `Fetch provider "${mode}" is not configured. ` +
        `Set the required environment variable or switch to WEB_FETCH_PROVIDER=auto.`,
      )
    }
  }

  const errors: Error[] = []

  for (const provider of chain) {
    try {
      return await provider.fetch(url, signal)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // Cancellation must stop immediately
      if (error.name === 'AbortError' || signal?.aborted) {
        throw error
      }

      errors.push(error)

      // Specific mode: fail loudly, no fallback
      if (mode !== 'auto') {
        throw error
      }

      // Auto mode: log and try next
      console.error(`[web-fetch] ${provider.name} failed: ${error.message}`)
    }
  }

  // All providers failed in auto mode
  const lastErr = errors[errors.length - 1]
  if (!lastErr) throw new Error('All fetch providers failed with no error details.')
  if (errors.length === 1) throw lastErr
  throw new Error(
    `All ${errors.length} fetch providers failed:\n` +
    errors.map((e, i) => `  ${i + 1}. ${e.message}`).join('\n'),
  )
}
