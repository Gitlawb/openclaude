import type { SettingsJson } from '../../utils/settings/types.js'
import {
  classifyComplexity,
  isAutonomyEnabled,
  resolveTaskRoute,
  type RouteDecision,
} from '../autonomy/index.js'

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
  /** Optional effort hint from task tier (callers may ignore) */
  effort?: RouteDecision['effort']
  /** Autonomy / routing metadata for debugging */
  autonomy?: {
    tier: RouteDecision['tier']
    reason: string[]
    fallbackChain: string[]
    source: RouteDecision['source']
  }
}

export type ResolveAgentProviderOptions = {
  /** Latest user text for task-tier classification */
  userText?: string
  /** Whether the turn includes an image attachment */
  hasImage?: boolean
  /** Explicit model pin (env / UI) — highest priority when autonomy is on */
  userPinnedModel?: string
}

/**
 * Normalize an agent identifier for case-insensitive, hyphen/underscore-agnostic matching.
 */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

function resolveLegacyAgentProvider(
  name: string | undefined,
  subagentType: string | undefined,
  settings: SettingsJson,
): ProviderOverride | null {
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
 * Look up agent routing by name or subagent_type, then resolve via agentModels.
 *
 * When autonomy is enabled (settings or OPENCLAUDE_AUTONOMY=1), task-tier
 * classification + taskRouting take priority over static agentRouting.
 *
 * Priority: user pin → task policy → name > subagentType > "default" > null
 */
export function resolveAgentProvider(
  name: string | undefined,
  subagentType: string | undefined,
  settings: SettingsJson | null,
  options?: ResolveAgentProviderOptions,
): ProviderOverride | null {
  if (!settings) return null

  if (isAutonomyEnabled(settings)) {
    const classifier = settings.autonomy?.classifier ?? 'heuristic'
    const classification =
      classifier === 'off'
        ? {
            tier: 'standard' as const,
            reasons: ['classifier=off'],
          }
        : classifyComplexity({
            text: options?.userText ?? '',
            hasImage: options?.hasImage,
          })

    const decision = resolveTaskRoute({
      tier: classification.tier,
      agentName: name,
      subagentType,
      settings,
      userPinnedModel: options?.userPinnedModel,
    })

    if (decision) {
      return {
        model: decision.model,
        baseURL: decision.baseURL,
        apiKey: decision.apiKey,
        effort: decision.effort,
        autonomy: {
          tier: decision.tier,
          reason: [...classification.reasons, ...decision.reason],
          fallbackChain: decision.fallbackChain,
          source: decision.source,
        },
      }
    }
  }

  return resolveLegacyAgentProvider(name, subagentType, settings)
}
