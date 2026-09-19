/**
 * Ollama Web Search API adapter.
 *
 * Signed-in local Ollama servers proxy search through the experimental local
 * endpoint. An API key enables the hosted endpoint as a fallback.
 */

import { resolveActiveRouteIdFromEnv } from '../../../integrations/routeMetadata.js'
import { getOllamaApiBaseUrl } from '../../../utils/providerDiscovery.js'
import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, safeHostname, type ProviderOutput } from './types.js'
import { fetchJsonWithWebSearchTimeout } from './timeout.js'

const OLLAMA_HOSTED_WEB_SEARCH_URL = 'https://ollama.com/api/web_search'

type OllamaSearchTarget = {
  label: string
  url: string
  authorization?: string
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function getConfiguredLocalBaseUrl(): string | undefined {
  const explicitOllamaBaseUrl = nonEmpty(process.env.OLLAMA_BASE_URL)
  if (explicitOllamaBaseUrl) return explicitOllamaBaseUrl

  if (resolveActiveRouteIdFromEnv(process.env) !== 'ollama') return undefined

  return (
    nonEmpty(process.env.OPENAI_BASE_URL) ??
    nonEmpty(process.env.OPENAI_API_BASE)
  )
}

function getSearchTargets(): OllamaSearchTarget[] {
  const targets: OllamaSearchTarget[] = []
  const localBaseUrl = getConfiguredLocalBaseUrl()
  const apiKey = nonEmpty(process.env.OLLAMA_API_KEY)

  if (localBaseUrl) {
    targets.push({
      label: 'local',
      url: `${getOllamaApiBaseUrl(localBaseUrl)}/api/experimental/web_search`,
    })
  }

  if (apiKey) {
    targets.push({
      label: 'hosted',
      url: OLLAMA_HOSTED_WEB_SEARCH_URL,
      authorization: `Bearer ${apiKey}`,
    })
  }

  return targets
}

export const ollamaProvider: SearchProvider = {
  name: 'ollama',

  isConfigured() {
    return getSearchTargets().length > 0
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const targets = getSearchTargets()
    const errors: string[] = []

    if (targets.length === 0) {
      throw new Error(
        'Ollama search requires an active Ollama provider, OLLAMA_BASE_URL, or OLLAMA_API_KEY.',
      )
    }

    for (const [targetIndex, target] of targets.entries()) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (target.authorization) {
          headers.Authorization = target.authorization
        }

        const data = await fetchJsonWithWebSearchTimeout(
          target.url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query: input.query,
              max_results: 10,
            }),
          },
          signal,
          { providerName: `Ollama ${target.label}` },
        )

        if (!data || !Array.isArray(data.results)) {
          throw new Error('response did not contain a results array')
        }

        const hits = data.results
          .filter((result: unknown): result is Record<string, unknown> =>
            Boolean(result) && typeof result === 'object',
          )
          .map(result => {
            const title = typeof result.title === 'string' ? result.title : ''
            const url = typeof result.url === 'string' ? result.url : ''
            const content =
              typeof result.content === 'string' ? result.content : undefined
            return {
              title: title || url,
              url,
              description: content,
              source: safeHostname(url),
            }
          })
          .filter(hit => Boolean(hit.title && hit.url))

        if (hits.length === 0 && targetIndex < targets.length - 1) {
          throw new Error('response contained no usable results')
        }

        return {
          hits: applyDomainFilters(hits, input),
          providerName: 'ollama',
          durationSeconds: (performance.now() - start) / 1000,
        }
      } catch (error) {
        if (isAbortError(error, signal)) throw error
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${target.label}: ${message}`)
      }
    }

    throw new Error(`Ollama web search failed (${errors.join('; ')})`)
  },
}
