/**
 * Ollama model discovery for the /model picker.
 * Fetches available models from the Ollama API and caches them
 * so the synchronous getModelOptions() can use them.
 */

import type { ModelOption } from './modelOptions.js'
import { getOllamaApiBaseUrl } from '../providerDiscovery.js'

let cachedOllamaOptions: ModelOption[] | null = null
let fetchPromise: Promise<ModelOption[]> | null = null

/**
 * Returns true when the current OPENAI_BASE_URL points at an Ollama instance
 * (local or cloud). Detects OLLAMA_BASE_URL presence, /v1 suffixed URLs,
 * the raw base URL, and ollama.com for cloud.
 */
export function isOllamaProvider(): boolean {
  // Explicit OLLAMA_BASE_URL is always sufficient
  if (process.env.OLLAMA_BASE_URL) return true
  if (!process.env.OPENAI_BASE_URL) return false
  const baseUrl = process.env.OPENAI_BASE_URL
  // Match common Ollama port
  try {
    const parsed = new URL(baseUrl)
    if (parsed.port === '11434') return true
    // Match Ollama Cloud
    const hostname = parsed.hostname.toLowerCase()
    if (hostname === 'ollama.com' || hostname.endsWith('.ollama.com')) return true
  } catch {
    // ignore
  }
  return false
}

/**
 * Fetch models from the Ollama /api/tags endpoint.
 * For Ollama Cloud, includes the Authorization header with OLLAMA_API_KEY.
 */
export async function fetchOllamaModels(): Promise<ModelOption[]> {
  const apiUrl = getOllamaApiBaseUrl()
  if (!apiUrl) return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  const headers: Record<string, string> = {}
  const apiKey = process.env.OLLAMA_API_KEY
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(`${apiUrl}/api/tags`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) return []

    const data = (await response.json()) as {
      models?: Array<{
        name?: string
        size?: number
        details?: {
          parameter_size?: string
          quantization_level?: string
          family?: string
        }
      }>
    }

    return (data.models ?? [])
      .filter(m => Boolean(m.name))
      .map(m => {
        const paramSize = m.details?.parameter_size ?? ''
        const quant = m.details?.quantization_level ?? ''
        const sizeGB = m.size ? `${(m.size / 1e9).toFixed(1)}GB` : ''
        const parts = [paramSize, quant, sizeGB].filter(Boolean).join(' · ')
        return {
          value: m.name!,
          label: m.name!,
          description: parts ? `Ollama · ${parts}` : 'Ollama model',
        }
      })
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Prefetch and cache Ollama models. Call during startup.
 */
export function prefetchOllamaModels(): void {
  if (!isOllamaProvider()) return
  if (cachedOllamaOptions && cachedOllamaOptions.length > 0) return
  if (fetchPromise) return
  fetchPromise = fetchOllamaModels()
    .then(options => {
      cachedOllamaOptions = options
      return options
    })
    .finally(() => {
      fetchPromise = null
    })
}

/**
 * Get cached Ollama model options (synchronous).
 * Returns empty array if not yet fetched.
 */
export function getCachedOllamaModelOptions(): ModelOption[] {
  return cachedOllamaOptions ?? []
}
