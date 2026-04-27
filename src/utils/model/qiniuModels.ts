import type { ModelOption } from './modelOptions.js'

const DEFAULT_QINIU_BASE_URL = 'https://api.qnaigc.com/v1'
const DEFAULT_QINIU_MODEL = 'deepseek-v3'
const DISCOVERY_TIMEOUT_MS = 5000
const DISCOVERED_MODEL_DESCRIPTION = 'Discovered from qiniu endpoint'

type OpenAIModelsResponse = {
  data?: Array<{
    id?: string | null
  }>
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_QINIU_BASE_URL).replace(
    /\/+$/,
    '',
  )
}

export function isQiniuProvider(): boolean {
  if (typeof process.env.QINIU_API_KEY === 'string' && process.env.QINIU_API_KEY.trim() !== '') {
    return true
  }

  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL)
  return baseUrl.toLowerCase().includes('qnaigc.com')
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

export async function discoverQiniuModelOptions(): Promise<ModelOption[]> {
  const baseUrl = normalizeBaseUrl()
  const apiKey = process.env.QINIU_API_KEY?.trim()

  if (!apiKey) {
    return getCachedQiniuModelOptions()
  }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (!response.ok) {
      return getCachedQiniuModelOptions()
    }
    const timeoutPromise = new Promise<OpenAIModelsResponse>((_, reject) => {
      setTimeout(() => reject(new Error('qiniu model discovery timeout')), DISCOVERY_TIMEOUT_MS)
    })
    const data = await Promise.race([
      response.json() as Promise<OpenAIModelsResponse>,
      timeoutPromise,
    ])

    const modelNames = uniqueModelNames(
      (data.data ?? [])
        .map(model => model.id ?? '')
        .filter((model): model is string => model.length > 0),
    )

    if (modelNames.length === 0) {
      return getCachedQiniuModelOptions()
    }

    const discoveredOptions = modelNames.map(modelName => ({
      value: modelName,
      label: modelName,
      description: DISCOVERED_MODEL_DESCRIPTION,
    }))
    cachedQiniuOptions = discoveredOptions
    return discoveredOptions
  } catch {
    return getCachedQiniuModelOptions()
  }
}

let cachedQiniuOptions: ModelOption[] | null = null

export function getCachedQiniuModelOptions(): ModelOption[] {
  if (!cachedQiniuOptions) {
    cachedQiniuOptions = [
      {
        value: DEFAULT_QINIU_MODEL,
        label: DEFAULT_QINIU_MODEL,
        description: 'Default qiniu model',
      },
    ]
  }
  return cachedQiniuOptions
}
