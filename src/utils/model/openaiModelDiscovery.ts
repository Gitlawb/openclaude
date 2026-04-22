import axios from 'axios'
import { logForDebugging } from '../debug.js'
import type { ModelOption } from './modelOptions.js'
import { getAPIProvider } from './providers.js'
import { hasCustomAuthHeader, parseCustomHeadersEnv } from '../customHeaders.js'

const DISCOVERY_TIMEOUT_MS = 5000
const DISCOVERED_MODEL_DESCRIPTION =
  'Discovered from OpenAI-compatible endpoint'

type OpenAIModelsResponse = {
  data?: Array<{
    id?: string | null
  }>
}

type OllamaTagsResponse = {
  models?: Array<{
    name?: string | null
  }>
}

function getNormalizedOpenAIBaseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
}

function isAzureOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return (
      hostname.endsWith('.openai.azure.com') ||
      hostname.endsWith('.cognitiveservices.azure.com')
    )
  } catch {
    return false
  }
}

function getOpenAIAuthHeaders(baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    ...parseCustomHeadersEnv(process.env.OPENAI_CUSTOM_HEADERS),
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey || hasCustomAuthHeader(headers)) {
    return headers
  }

  headers.Authorization = `Bearer ${apiKey}`

  if (isAzureOpenAIBaseUrl(baseUrl)) {
    headers['api-key'] = apiKey
  }

  return headers
}

function getModelListUrls(baseUrl: string): string[] {
  const primary = baseUrl.endsWith('/v1')
    ? `${baseUrl}/models`
    : `${baseUrl}/v1/models`
  const secondary = `${baseUrl}/models`

  const apiVersion = process.env.OPENAI_API_VERSION?.trim()
  const addApiVersion =
    apiVersion && isAzureOpenAIBaseUrl(baseUrl)
      ? (url: string): string => {
          try {
            const parsed = new URL(url)
            parsed.searchParams.set('api-version', apiVersion)
            return parsed.toString()
          } catch {
            return url
          }
        }
      : (url: string): string => url

  if (primary === secondary) {
    return [addApiVersion(primary)]
  }

  return [addApiVersion(primary), addApiVersion(secondary)]
}

function getOllamaTagsUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl)
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    const pathPrefix = normalizedPath.endsWith('/v1')
      ? normalizedPath.slice(0, -3)
      : normalizedPath
    const tagsPath = `${pathPrefix}/api/tags`.replace(/\/{2,}/g, '/')
    return `${parsed.origin}${tagsPath}`
  } catch {
    return null
  }
}

function uniqueModelNames(modelNames: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const modelName of modelNames) {
    const trimmed = modelName.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    unique.push(trimmed)
  }

  return unique
}

async function fetchOpenAIModels(
  urls: string[],
  headers: Record<string, string>,
): Promise<string[]> {
  for (const url of urls) {
    try {
      const response = await axios.get<OpenAIModelsResponse>(url, {
        headers,
        timeout: DISCOVERY_TIMEOUT_MS,
      })
      const modelNames = uniqueModelNames(
        (response.data?.data ?? [])
          .map(model => model.id ?? '')
          .filter((model): model is string => model.length > 0),
      )
      if (modelNames.length > 0) {
        return modelNames
      }
    } catch {
      logForDebugging(`[ModelDiscovery] Failed to fetch OpenAI models from ${url}`)
    }
  }

  return []
}

async function fetchOllamaModels(
  url: string,
  headers: Record<string, string>,
): Promise<string[]> {
  try {
    const response = await axios.get<OllamaTagsResponse>(url, {
      headers,
      timeout: DISCOVERY_TIMEOUT_MS,
    })
    return uniqueModelNames(
      (response.data?.models ?? [])
        .map(model => model.name ?? '')
        .filter((model): model is string => model.length > 0),
    )
  } catch {
    logForDebugging(`[ModelDiscovery] Failed to fetch Ollama models from ${url}`)
    return []
  }
}

export async function discoverOpenAICompatibleModelOptions(): Promise<
  ModelOption[]
> {
  if (getAPIProvider() !== 'openai') {
    return []
  }

  const baseUrl = getNormalizedOpenAIBaseUrl()
  const headers = getOpenAIAuthHeaders(baseUrl)

  let discoveredModelNames = await fetchOpenAIModels(
    getModelListUrls(baseUrl),
    headers,
  )

  if (discoveredModelNames.length === 0) {
    const ollamaTagsUrl = getOllamaTagsUrl(baseUrl)
    if (ollamaTagsUrl) {
      discoveredModelNames = await fetchOllamaModels(ollamaTagsUrl, headers)
    }
  }

  return discoveredModelNames.map(modelName => ({
    value: modelName,
    label: modelName,
    description: DISCOVERED_MODEL_DESCRIPTION,
  }))
}
