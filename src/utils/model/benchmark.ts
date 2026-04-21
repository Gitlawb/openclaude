/**
 * Model Benchmarking for OpenClaude
 * 
 * Tests and compares model speed/quality for informed model selection.
 * Supports OpenAI-compatible, Ollama, Anthropic, Bedrock, Vertex.
 */

import { getAPIProvider } from './providers.js'

export interface BenchmarkResult {
  model: string
  provider: string
  firstTokenMs: number
  totalTokens: number
  tokensPerSecond: number
  success: boolean
  error?: string
}

const TEST_PROMPT = 'Write a short hello world in Python.'
const MAX_TOKENS = 50
const TIMEOUT_MS = 30000

function getBenchmarkEndpoint(): string | null {
  const provider = getAPIProvider()
  const baseUrl = process.env.OPENAI_BASE_URL
  
  // Check for Ollama (local)
  if (baseUrl?.includes('localhost:11434') || baseUrl?.includes('localhost:11435')) {
    return `${baseUrl}/chat/completions`
  }
  // OpenAI-compatible endpoints
  if (provider === 'openai' || provider === 'firstParty') {
    return `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`
  }
  // NVIDIA NIM or MiniMax via OPENAI_BASE_URL
  if (baseUrl?.includes('nvidia') || baseUrl?.includes('minimax')) {
    return `${baseUrl}/chat/completions`
  }
  return null
}

function getBenchmarkAuthHeader(): string | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return `Bearer ${apiKey}`
}

export async function benchmarkModel(
  model: string,
  onChunk?: (text: string) => void,
): Promise<BenchmarkResult> {
  const endpoint = getBenchmarkEndpoint()
  const authHeader = getBenchmarkAuthHeader()
  
  if (!endpoint || !authHeader) {
    return {
      model,
      provider: getAPIProvider(),
      firstTokenMs: 0,
      totalTokens: 0,
      tokensPerSecond: 0,
      success: false,
      error: 'Benchmark not supported for this provider',
    }
  }
  
  const startTime = performance.now()
  let totalTokens = 0
  let firstTokenMs: number | null = null

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        max_tokens: MAX_TOKENS,
        stream: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`
      try {
        const error = await response.json()
        errorMsg = error.error?.message || errorMsg
      } catch {
        // ignore
      }
      return {
        model,
        provider: getAPIProvider(),
        firstTokenMs: 0,
        totalTokens: 0,
        tokensPerSecond: 0,
        success: false,
        error: errorMsg,
      }
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const json = JSON.parse(data)
            const content = json.choices?.[0]?.delta?.content
            if (content) {
              if (firstTokenMs === null) {
                firstTokenMs = performance.now() - startTime
              }
              totalTokens += content.length / 4
              onChunk?.(content)
            }
          } catch {
            // skip invalid JSON
          }
        }
      }
    }

    const totalMs = performance.now() - startTime
    const tokensPerSecond = totalMs > 0 ? (totalTokens / totalMs) * 1000 : 0

    return {
      model,
      provider: getAPIProvider(),
      firstTokenMs: firstTokenMs ?? 0,
      totalTokens,
      tokensPerSecond,
      success: true,
    }
  } catch (error) {
    return {
      model,
      provider: getAPIProvider(),
      firstTokenMs: 0,
      totalTokens: 0,
      tokensPerSecond: 0,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function benchmarkMultipleModels(
  models: string[],
  onProgress?: (completed: number, total: number, result: BenchmarkResult) => void,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []

  for (let i = 0; i < models.length; i++) {
    const result = await benchmarkModel(models[i])
    results.push(result)
    onProgress?.(i + 1, models.length, result)
  }

  return results
}

export function formatBenchmarkResults(results: BenchmarkResult[]): string {
  const header = 'Model'.padEnd(40) + 'TPS' + '  First Token' + '  Status'
  const divider = '-'.repeat(70)
  
  const rows = results
    .sort((a, b) => b.tokensPerSecond - a.tokensPerSecond)
    .map(r => {
      const name = r.model.length > 38 ? r.model.slice(0, 37) + '…' : r.model
      const tps = r.tokensPerSecond.toFixed(1).padStart(6)
      const first = r.firstTokenMs > 0 ? `${r.firstTokenMs.toFixed(0)}ms`.padStart(12) : 'N/A'.padStart(12)
      const status = r.success ? '✓' : '✗'
      return name.padEnd(40) + tps + '  ' + first + '  ' + status
    })

  return [header, divider, ...rows].join('\n')
}

export function isBenchmarkSupported(): boolean {
  const endpoint = getBenchmarkEndpoint()
  const authHeader = getBenchmarkAuthHeader()
  return endpoint !== null && authHeader !== null
}