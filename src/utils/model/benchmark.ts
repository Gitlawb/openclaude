/**
 * Model Benchmarking for OpenClaude
 * 
 * Tests and compares model speed/quality for informed model selection.
 */

import { getAPIProvider } from './providers.js'
import { isOllamaProvider } from './ollamaModels.js'
import { isNvidiaNimProvider } from './nvidiaNimModels.js'
import { isMiniMaxProvider } from './minimaxModels.js'

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

export async function benchmarkModel(
  model: string,
  onChunk?: (text: string) => void,
): Promise<BenchmarkResult> {
  const startTime = performance.now()
  let totalTokens = 0
  let firstTokenMs: number | null = null

  try {
    const response = await fetch(`${process.env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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
      const error = await response.json()
      return {
        model,
        provider: getAPIProvider(),
        firstTokenMs: 0,
        totalTokens: 0,
        tokensPerSecond: 0,
        success: false,
        error: error.error?.message || `HTTP ${response.status}`,
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
              totalTokens += content.length / 4 // rough estimate
              onChunk?.(content)
            }
          } catch {
            // skip invalid JSON
          }
        }
      }
    }

    const totalMs = performance.now() - startTime
    const tokensPerSecond = (totalTokens / totalMs) * 1000

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
  const provider = getAPIProvider()
  return isOllamaProvider() || isNvidiaNimProvider() || isMiniMaxProvider() || provider === 'openai'
}