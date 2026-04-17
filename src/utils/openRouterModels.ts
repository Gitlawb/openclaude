export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export type OpenRouterModel = {
  id: string
  name: string
  contextLength: number
  /** USD per million prompt tokens, or null if unknown */
  promptPricePerMToken: number | null
  /** USD per million completion tokens, or null if unknown */
  completionPricePerMToken: number | null
}

/**
 * Fetches the list of available models from OpenRouter with full metadata.
 * Returns an empty array on error or timeout.
 */
export async function listOpenRouterModels(
  apiKey?: string,
): Promise<OpenRouterModel[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const headers: Record<string, string> = {
      'HTTP-Referer': 'https://github.com/anthropics/claude-code',
    }
    const key = apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }

    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as {
      data?: Array<{
        id?: string
        name?: string
        context_length?: number
        pricing?: {
          prompt?: string | number
          completion?: string | number
        }
      }>
    }

    const toPerMToken = (raw: string | number | undefined): number | null => {
      if (raw === undefined || raw === null) return null
      const value = parseFloat(String(raw)) * 1_000_000
      return Number.isFinite(value) ? value : null
    }

    return (data.data ?? [])
      .filter(m => Boolean(m.id))
      .map(m => ({
        id: m.id!,
        name: m.name || m.id!,
        contextLength: typeof m.context_length === 'number' ? m.context_length : 0,
        promptPricePerMToken: toPerMToken(m.pricing?.prompt),
        completionPricePerMToken: toPerMToken(m.pricing?.completion),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

/** Returns true if the current env is configured to use OpenRouter. */
export function isOpenRouterProvider(): boolean {
  const baseUrl = process.env.OPENAI_BASE_URL ?? ''
  return (
    process.env.CLAUDE_CODE_USE_OPENAI === '1' &&
    baseUrl.includes('openrouter.ai')
  )
}
