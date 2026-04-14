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
  | 'mistral'

export function getAPIProvider(): APIProvider {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    return 'gemini'
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)) {
    return 'mistral'
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    return 'github'
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) {
    const baseUrl =
      process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE ?? ''
    if (/google|gemini/i.test(baseUrl)) {
      return 'gemini'
    }
    return isCodexModel() ? 'codex' : 'openai'
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) {
    return 'bedrock'
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) {
    return 'vertex'
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) {
    return 'foundry'
  }

  return 'firstParty'
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
