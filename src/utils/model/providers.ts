// ---------------------------------------------------------------------------
// ZAI (Zhipu AI) — GLM models via Anthropic-compatible endpoint
//
// ZAI provides an Anthropic-compatible API for GLM models. It uses the
// existing firstParty/Anthropic code path with a custom base URL.
//
// Configuration (set these environment variables):
//   ANTHROPIC_API_KEY=your-zai-api-key        # or ZAI_API_KEY via a wrapper
//   ANTHROPIC_BASE_URL=https://api.z.ai/api/paas/v4          # General endpoint
//   # or: ANTHROPIC_BASE_URL=https://api.z.ai/api/coding/paas/v4  # Coding Plan (preserved thinking)
//   ANTHROPIC_DEFAULT_SONNET_MODEL=glm-4.7
//   ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1
//   ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5-turbo
//
// GLM features via ZAI:
//   - Interleaved thinking: supported by default since GLM-4.5
//   - Preserved thinking: enabled by default on the Coding Plan endpoint
//   - Authentication: Bearer token (ZAI API key passed as ANTHROPIC_API_KEY)
//
// Available GLM models:
//   glm-5.1      — 200K context, premium tier
//   glm-4.7      — 200K context, standard tier
//   glm-4.5-air  — 200K context, economy tier
//   glm-5-turbo  — 200K context, fast economy tier
// ---------------------------------------------------------------------------

import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { shouldUseCodexTransport } from '../../services/api/providerConfig.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'github'
  | 'codex'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
    ? 'gemini'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
      ? 'github'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
        ? isCodexModel()
          ? 'codex'
          : 'openai'
        : isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
          ? 'bedrock'
          : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
            ? 'vertex'
            : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
              ? 'foundry'
              : 'firstParty'
}

export function usesAnthropicAccountFlow(): boolean {
  return getAPIProvider() === 'firstParty'
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
