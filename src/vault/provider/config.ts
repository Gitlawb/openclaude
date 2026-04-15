import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type BridgeAIConfig = {
  provider?: string
  apiKey?: string
  model?: string
}

/**
 * Load bridge-ai config from ~/.bridgeai/config.json.
 * Returns null if file doesn't exist or is malformed.
 */
export function loadBridgeAIConfig(): BridgeAIConfig | null {
  try {
    const configPath = join(getClaudeConfigHomeDir(), 'config.json')
    if (!existsSync(configPath)) return null
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Apply bridge-ai config to environment.
 * Sets ANTHROPIC_API_KEY from config if not already set via env var.
 * Should be called early in bootstrap, before provider detection.
 */
export function applyBridgeAIConfig(): void {
  const config = loadBridgeAIConfig()
  if (!config) return

  // API key: config is fallback, env var takes precedence
  if (config.apiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = config.apiKey
  }

  // Model: config is fallback
  if (config.model && !process.env.ANTHROPIC_MODEL) {
    process.env.ANTHROPIC_MODEL = config.model
  }
}
