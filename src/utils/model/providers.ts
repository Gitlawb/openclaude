import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { shouldUseCodexTransport } from '../../services/api/providerConfig.js'
import {
  getTransportKindForRoute,
  resolveActiveRouteIdFromEnv,
} from '../../integrations/routeMetadata.js'
import { isEnvTruthy } from '../envUtils.js'

// Legacy provider categories that older model/status/runtime callers still
// consume. Descriptor route ids are the newer source of truth, but we keep
// this compatibility surface stable until later cleanup packets retire it.
export type LegacyAPIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'github'
  | 'codex'
  | 'nvidia-nim'
  | 'minimax'
  | 'mistral'
  | 'xai'

// Backward-compatible public alias. Keep importing APIProvider where callers
// intentionally consume the legacy category surface.
export type APIProvider = LegacyAPIProvider

export function getAPIProvider(): LegacyAPIProvider {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) {
    return 'foundry'
  }

  const activeRouteId = resolveActiveRouteIdFromEnv(process.env)

  switch (activeRouteId) {
    case 'gemini':
      return 'gemini'
    case 'mistral':
      return 'mistral'
    case 'github':
      return 'github'
    case 'bedrock':
      return 'bedrock'
    case 'vertex':
      return 'vertex'
    case 'nvidia-nim':
      return 'nvidia-nim'
    case 'minimax':
      return 'minimax'
    case 'xai':
      return 'xai'
    case 'openai':
    case 'custom':
      if (isEnvTruthy(process.env.NVIDIA_NIM)) {
        return 'nvidia-nim'
      }
      return isCodexModel() ? 'codex' : 'openai'
    case 'anthropic':
    default:
      if (
        activeRouteId &&
        activeRouteId !== 'anthropic' &&
        ['local', 'openai-compatible'].includes(
          getTransportKindForRoute(activeRouteId) ?? '',
        )
      ) {
        return 'openai'
      }

      if (isEnvTruthy(process.env.NVIDIA_NIM)) {
        return 'nvidia-nim'
      }

      // Preserve the legacy MiniMax env-only signal as a fallback for users
      // who still export MINIMAX_API_KEY without the newer route/base-url env.
      if (
        typeof process.env.MINIMAX_API_KEY === 'string' &&
        process.env.MINIMAX_API_KEY.trim() !== ''
      ) {
        return 'minimax'
      }

      if (
        typeof process.env.XAI_API_KEY === 'string' &&
        process.env.XAI_API_KEY.trim() !== ''
      ) {
        return 'xai'
      }

      return 'firstParty'
  }
}

export function usesAnthropicAccountFlow(): boolean {
  return getAPIProvider() === 'firstParty'
}

/**
 * Returns true when the GitHub provider should use Anthropic's native API
 * format instead of the OpenAI-compatible shim.
 *
 * Enabled when CLAUDE_CODE_USE_GITHUB=1 and the model string contains "claude-"
 * anywhere (handles bare names like "claude-sonnet-4" and compound formats like
 * "github:copilot:claude-sonnet-4" or any future provider-prefixed variants).
 *
 * api.githubcopilot.com supports Anthropic native format for Claude models,
 * enabling prompt caching via cache_control blocks which significantly reduces
 * per-turn token costs by caching the system prompt and tool definitions.
 */
export function isGithubNativeAnthropicMode(resolvedModel?: string): boolean {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) return false
  const model = resolvedModel?.trim() || process.env.OPENAI_MODEL?.trim() || ''
  return model.toLowerCase().includes('claude-')
}
function isCodexModel(): boolean {
  return shouldUseCodexTransport(
    process.env.OPENAI_MODEL || '',
    process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE,
  )
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
