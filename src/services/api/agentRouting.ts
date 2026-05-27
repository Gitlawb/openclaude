import type { SettingsJson } from '../../utils/settings/types.js'

/**
 * Provider override resolved from agent routing config.
 * When present, the API client should use these instead of global env vars.
 */
export interface ProviderOverride {
  /** Model name to send to the API (e.g. "deepseek-chat", "gpt-4o") */
  model: string
  /** OpenAI-compatible base URL */
  baseURL: string
  /** API key for this provider */
  apiKey: string
}

export interface AgentRunModelRouting {
  mainLoopModel: string
  providerOverride?: ProviderOverride
}

/**
 * Normalize an agent identifier for case-insensitive, hyphen/underscore-agnostic matching.
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
      console.error(
        `[agentRouting] Warning: routing key "${key}" collides with an existing key after normalization (both map to "${nk}"). First entry wins.`,
      )
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
  }
}

/**
 * Resolve provider override directly from a requested model name.
 * Checks for an exact match in agentModels. Does not fuzzy match or normalize case.
 */
export function resolveAgentModelProvider(
  modelName: string | undefined,
  settings: SettingsJson | null,
): ProviderOverride | null {
  if (!settings || !settings.agentModels || !modelName) return null

  const trimmedModelName = modelName.trim()
  const modelConfig = settings.agentModels[trimmedModelName]

  if (modelConfig) {
    return {
      model: trimmedModelName,
      baseURL: modelConfig.base_url,
      apiKey: modelConfig.api_key,
    }
  }

  return null
}

export function resolveAgentRunModelRouting({
  resolvedAgentModel,
  toolSpecifiedModel,
  agentName,
  subagentType,
  agentDefinitionModel,
  settings,
}: {
  resolvedAgentModel: string
  toolSpecifiedModel?: string
  agentName?: string
  subagentType?: string
  agentDefinitionModel?: string
  settings: SettingsJson | null
}): AgentRunModelRouting {
  const toolRequestedModel = toolSpecifiedModel?.trim()
  if (toolRequestedModel) {
    // Tool-specified models are explicit. If the request is not a configured
    // agentModels key, preserve getAgentModel() alias/inherit/custom-ID behavior
    // instead of falling through to persistent agentRouting.
    const providerOverride = resolveAgentModelProvider(toolRequestedModel, settings)
    return {
      mainLoopModel: providerOverride?.model ?? resolvedAgentModel,
      ...(providerOverride && { providerOverride }),
    }
  }

  const providerOverride =
    resolveAgentProvider(agentName, subagentType, settings) ??
    resolveAgentModelProvider(agentDefinitionModel, settings)

  return {
    mainLoopModel: providerOverride?.model ?? resolvedAgentModel,
    ...(providerOverride && { providerOverride }),
  }
}
