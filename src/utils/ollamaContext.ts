import { execFileNoThrow } from './execFileNoThrow.js'

export const MIN_RECOMMENDED_OLLAMA_CONTEXT_TOKENS = 32_768

export type OllamaContextWarning = {
  modelName: string
  contextValue: string
  contextTokens: number
}

function parseContextTokenValue(value: string | undefined): number | null {
  const normalized = value?.trim().replace(/,/g, '')
  if (!normalized) {
    return null
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/)
  if (!match) {
    return null
  }

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  const suffix = match[2].toLowerCase()
  if (suffix === 'm') {
    return Math.round(amount * 1_000_000)
  }
  if (suffix === 'k') {
    return Math.round(amount * 1_024)
  }
  return Math.round(amount)
}

function normalizeOllamaModelName(modelName: string | undefined): string | null {
  const normalized = modelName?.trim().toLowerCase().split('?')[0]
  return normalized || null
}

export function parseOllamaPsContextWarning(
  output: string,
  activeModelName?: string,
): OllamaContextWarning | null {
  const normalizedActiveModel = normalizeOllamaModelName(activeModelName)
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return null
  }

  const header = lines[0]
  const contextColumnStart = header.toLowerCase().indexOf('context')
  if (contextColumnStart === -1) {
    return null
  }

  for (const line of lines.slice(1)) {
    const modelName = line.split(/\s+/)[0] ?? 'loaded model'
    if (
      normalizedActiveModel &&
      normalizeOllamaModelName(modelName) !== normalizedActiveModel
    ) {
      continue
    }

    const contextValue = line.slice(contextColumnStart).trim().split(/\s+/)[0]
    const contextTokens = parseContextTokenValue(contextValue)
    if (
      contextTokens !== null &&
      contextTokens < MIN_RECOMMENDED_OLLAMA_CONTEXT_TOKENS
    ) {
      return {
        modelName,
        contextValue,
        contextTokens,
      }
    }
  }

  return null
}

export async function checkOllamaPsContextWarning(
  activeModelName?: string,
): Promise<OllamaContextWarning | null> {
  const result = await execFileNoThrow('ollama', ['ps'], {
    timeout: 1000,
    preserveOutputOnError: true,
    useCwd: false,
  })
  if (result.code !== 0 || !result.stdout.trim()) {
    return null
  }

  return parseOllamaPsContextWarning(result.stdout, activeModelName)
}
