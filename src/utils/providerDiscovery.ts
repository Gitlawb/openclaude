import type { OllamaModelDescriptor } from './providerRecommendation.ts'
import { DEFAULT_OPENAI_BASE_URL } from '../services/api/providerConfig.js'

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'
export const DEFAULT_ATOMIC_CHAT_BASE_URL = 'http://127.0.0.1:1337'

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal
  clear: () => void
} {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getOllamaApiBaseUrl(baseUrl?: string): string {
  const parsed = new URL(
    baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
  )
  const pathname = trimTrailingSlash(parsed.pathname)
  parsed.pathname = pathname.endsWith('/v1')
    ? pathname.slice(0, -3) || '/'
    : pathname || '/'
  parsed.search = ''
  parsed.hash = ''
  return trimTrailingSlash(parsed.toString())
}

export function getOllamaChatBaseUrl(baseUrl?: string): string {
  return `${getOllamaApiBaseUrl(baseUrl)}/v1`
}

export function getAtomicChatApiBaseUrl(baseUrl?: string): string {
  const parsed = new URL(
    baseUrl || process.env.ATOMIC_CHAT_BASE_URL || DEFAULT_ATOMIC_CHAT_BASE_URL,
  )
  const pathname = trimTrailingSlash(parsed.pathname)
  parsed.pathname = pathname.endsWith('/v1')
    ? pathname.slice(0, -3) || '/'
    : pathname || '/'
  parsed.search = ''
  parsed.hash = ''
  return trimTrailingSlash(parsed.toString())
}

export function getAtomicChatChatBaseUrl(baseUrl?: string): string {
  return `${getAtomicChatApiBaseUrl(baseUrl)}/v1`
}

export function getOpenAICompatibleModelsBaseUrl(baseUrl?: string): string {
  return (
    baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL
  ).replace(/\/+$/, '')
}

export function getLocalOpenAICompatibleProviderLabel(baseUrl?: string): string {
  try {
    const parsed = new URL(getOpenAICompatibleModelsBaseUrl(baseUrl))
    const host = parsed.host.toLowerCase()
    const hostname = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const haystack = `${hostname} ${path}`

    if (haystack.includes('openrouter')) {
      return 'OpenRouter'
    }
    if (
      host.endsWith(':1234') ||
      haystack.includes('lmstudio') ||
      haystack.includes('lm-studio')
    ) {
      return 'LM Studio'
    }
    if (host.endsWith(':11434') || haystack.includes('ollama')) {
      return 'Ollama'
    }
    if (haystack.includes('localai')) {
      return 'LocalAI'
    }
    if (haystack.includes('jan')) {
      return 'Jan'
    }
    if (haystack.includes('kobold')) {
      return 'KoboldCpp'
    }
    if (haystack.includes('llama.cpp') || haystack.includes('llamacpp')) {
      return 'llama.cpp'
    }
    if (haystack.includes('vllm')) {
      return 'vLLM'
    }
    if (
      haystack.includes('open-webui') ||
      haystack.includes('openwebui')
    ) {
      return 'Open WebUI'
    }
    if (
      haystack.includes('text-generation-webui') ||
      haystack.includes('oobabooga')
    ) {
      return 'text-generation-webui'
    }
    // Check for NVIDIA NIM
    if (host.includes('nvidia') || haystack.includes('nvidia') || host.includes('integrate.api.nvidia')) {
      return 'NVIDIA NIM'
    }
    // Check for MiniMax (both api.minimax.io and api.minimax.chat)
    if (host.includes('minimax') || haystack.includes('minimax')) {
      return 'MiniMax'
    }
  } catch {
    // Fall back to the generic label when the base URL is malformed.
  }

  return 'Local OpenAI-compatible'
}

export async function hasLocalOllama(baseUrl?: string): Promise<boolean> {
  const { signal, clear } = withTimeoutSignal(1200)
  try {
    const response = await fetch(`${getOllamaApiBaseUrl(baseUrl)}/api/tags`, {
      method: 'GET',
      signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clear()
  }
}

export async function listOllamaModels(
  baseUrl?: string,
): Promise<OllamaModelDescriptor[]> {
  const { signal, clear } = withTimeoutSignal(5000)
  try {
    const response = await fetch(`${getOllamaApiBaseUrl(baseUrl)}/api/tags`, {
      method: 'GET',
      signal,
    })
    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as {
      models?: Array<{
        name?: string
        size?: number
        details?: {
          family?: string
          families?: string[]
          parameter_size?: string
          quantization_level?: string
        }
      }>
    }

    return (data.models ?? [])
      .filter(model => Boolean(model.name))
      .map(model => ({
        name: model.name!,
        sizeBytes: typeof model.size === 'number' ? model.size : null,
        family: model.details?.family ?? null,
        families: model.details?.families ?? [],
        parameterSize: model.details?.parameter_size ?? null,
        quantizationLevel: model.details?.quantization_level ?? null,
      }))
  } catch {
    return []
  } finally {
    clear()
  }
}

export async function listOpenAICompatibleModels(options?: {
  baseUrl?: string
  apiKey?: string
}): Promise<string[] | null> {
  const { signal, clear } = withTimeoutSignal(5000)
  try {
    const response = await fetch(
      `${getOpenAICompatibleModelsBaseUrl(options?.baseUrl)}/models`,
      {
        method: 'GET',
        headers: options?.apiKey
          ? {
              Authorization: `Bearer ${options.apiKey}`,
            }
          : undefined,
        signal,
      },
    )
    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      data?: Array<{ id?: string }>
    }

    return Array.from(
      new Set(
        (data.data ?? [])
          .filter(model => Boolean(model.id))
          .map(model => model.id!),
      ),
    )
  } catch {
    return null
  } finally {
    clear()
  }
}

export async function hasLocalAtomicChat(baseUrl?: string): Promise<boolean> {
  const { signal, clear } = withTimeoutSignal(1200)
  try {
    const response = await fetch(`${getAtomicChatChatBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clear()
  }
}

export async function listAtomicChatModels(
  baseUrl?: string,
): Promise<string[]> {
  const { signal, clear } = withTimeoutSignal(5000)
  try {
    const response = await fetch(`${getAtomicChatChatBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      signal,
    })
    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as {
      data?: Array<{ id?: string }>
    }

    return (data.data ?? [])
      .filter(model => Boolean(model.id))
      .map(model => model.id!)
  } catch {
    return []
  } finally {
    clear()
  }
}

export async function benchmarkOllamaModel(
  modelName: string,
  baseUrl?: string,
): Promise<number | null> {
  const start = Date.now()
  const { signal, clear } = withTimeoutSignal(20000)
  try {
    const response = await fetch(`${getOllamaApiBaseUrl(baseUrl)}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        options: {
          temperature: 0,
          num_predict: 8,
        },
      }),
    })
    if (!response.ok) {
      return null
    }
    await response.json()
    return Date.now() - start
  } catch {
    return null
  } finally {
    clear()
  }
}
