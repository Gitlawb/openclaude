/**
 * Ollama model discovery for the /model picker.
 * Fetches available models from the Ollama API and caches them
 * so the synchronous getModelOptions() can use them.
 */

import type { ModelOption } from './modelOptions.js'

let cachedOllamaOptions: ModelOption[] | null = null
let fetchPromise: Promise<ModelOption[]> | null = null

/**
 * Returns true when the current OPENAI_BASE_URL points at an Ollama instance.
 * Detects both /v1 suffixed URLs and the raw base URL.
 */
export function isOllamaProvider(): boolean {
  if (!process.env.OLLAMA_BASE_URL && !process.env.OPENAI_BASE_URL) {
    return false
  }
  const baseUrl = process.env.OPENAI_BASE_URL ?? ''
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? ''
  // Match if OPENAI_BASE_URL is derived from OLLAMA_BASE_URL (e.g. host:11434/v1)
  if (ollamaUrl && baseUrl.startsWith(ollamaUrl)) return true
  // Match common Ollama port
  try {
    const parsed = new URL(baseUrl)
    if (parsed.port === '11434') return true
  } catch {
    // ignore
  }
  return false
}

function getOllamaApiUrl(): string {
  const ollamaBase = process.env.OLLAMA_BASE_URL
  if (ollamaBase) return ollamaBase.replace(/\/+$/, '')
  const openaiBase = process.env.OPENAI_BASE_URL ?? ''
  // Strip /v1 suffix to get raw Ollama URL
  return openaiBase.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
}

/**
 * Fetch models from the Ollama /api/tags endpoint.
 */
export async function fetchOllamaModels(): Promise<ModelOption[]> {
  const apiUrl = getOllamaApiUrl()
  if (!apiUrl) return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(`${apiUrl}/api/tags`, {
      method: 'GET',
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
  if (fetchPromise) return
  fetchPromise = fetchOllamaModels().then(options => {
    cachedOllamaOptions = options
    return options
  })
}

/**
 * Get cached Ollama model options (synchronous).
 * Returns empty array if not yet fetched.
 */
export function getCachedOllamaModelOptions(): ModelOption[] {
  return cachedOllamaOptions ?? []
}
