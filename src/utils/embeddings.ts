import { getAPIProvider } from './model/providers.js'

/**
 * Generate an embedding for the given text using the configured provider.
 * Uses native fetch to avoid extra SDK dependencies.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const provider = getAPIProvider()
    const apiKey = process.env.OPENAI_API_KEY || ''
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: getEmbeddingModel(provider),
        input: text.replace(/\n/g, ' ')
      })
    })

    if (!response.ok) return null
    
    const data = await response.json() as any
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

function getEmbeddingModel(provider: string): string {
  switch (provider) {
    case 'openai': return 'text-embedding-3-small'
    case 'gemini': return 'text-embedding-004'
    default: return 'text-embedding-3-small'
  }
}
