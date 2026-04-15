import { getAPIProvider } from '../../utils/model/providers.js'
import type { ProviderType } from '../types.js'

/**
 * Detect active AI provider from environment and config.
 * Priority: explicit config > API provider > env vars > default 'claude'
 */
export function detectProvider(explicitProvider?: ProviderType): ProviderType {
  if (explicitProvider) return explicitProvider

  // Map from OpenClaude's API provider to vault provider
  try {
    const apiProvider = getAPIProvider()
    if (apiProvider === 'gemini') return 'gemini'
    if (apiProvider === 'firstParty') return 'claude'
    // For other providers (openai, bedrock, vertex, etc.), fall through to env var checks
  } catch {
    // getAPIProvider may fail in test environments
  }

  // Cursor detection: CURSOR_TRACE_ID or CURSOR_SESSION env vars
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_SESSION) return 'cursor'

  // Gemini detection: GEMINI_API_KEY or GOOGLE_AI_API_KEY
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) return 'gemini'

  // Default to claude
  return 'claude'
}
