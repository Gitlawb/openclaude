import type { SettingsJson } from '../../utils/settings/types.js'
import type { ProviderOverride } from './authRouting.js'

/**
 * Look up agent.routing by name or subagent_type, then resolve via agent.models.
 */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

/**
 * Look up agent.routing by name or subagent_type, then resolve via agent.models.
 *
 * Priority: name > subagentType > "default" > null (use global provider)
 */
export function resolveAgentProvider(
  name: string | undefined,
  subagentType: string | undefined,
  settings: SettingsJson | null,
): ProviderOverride | null {
  if (!settings) return null

  const routing = settings.agentRouting
  const models = settings.agentModels
  if (!routing || !models) return null

  // Build normalized lookup from routing config.
  // Warn on duplicate normalized keys (e.g. "explore-agent" and "explore_agent"
  // both normalize to "exploreagent") to prevent silent shadowing.
  const normalizedRouting = new Map<string, string>()
  for (const [key, value] of Object.entries(routing)) {
    const nk = normalize(key)
    if (normalizedRouting.has(nk)) {
      console.error(`[agentRouting] Warning: routing key "${key}" collides with an existing key after normalization (both map to "${nk}"). First entry wins.`)
    }
    if (!normalizedRouting.has(nk)) {
      normalizedRouting.set(nk, value)
    }
  }

  // Try name first, then subagentType, then "default"
  const candidates = [name, subagentType, 'default'].filter(Boolean) as string[]
  let modelName: string | undefined

  for (const candidate of candidates) {
    const match = normalizedRouting.get(normalize(candidate))
    if (match) {
      modelName = match
      break
    }
  }

  if (!modelName) return null

  const modelConfig = models[modelName]
  if (!modelConfig) return null

  return {
    model: modelName,
    baseURL: modelConfig.base_url,
    apiKey: modelConfig.api_key,
    temperature: modelConfig.temperature,
    top_p: modelConfig.top_p,
  }
}
