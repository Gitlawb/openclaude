export {
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GITHUB_MODELS_API_MODEL,
  DEFAULT_MISTRAL_BASE_URL,
  DEFAULT_MISTRAL_MODEL,
  DEFAULT_OPENAI_BASE_URL,
} from './constants.js'

export {
  type ResolvedProviderRequest,
  type ResolvedCodexCredentials,
  type OpenAICompatibleApiFormat,
  type ProviderTransport,
  resolveProviderRequest,
  isLocalProviderUrl,
  getGithubEndpointType,
  isCodexBaseUrl,
  shouldUseCodexTransport,
  getAdditionalModelOptionsCacheScope,
  getLocalFastPathConfig,
  getLocalProviderRetryBaseUrls,
  shouldAttemptLocalToollessRetry,
  resolveCodexAuthPath,
  resolveRuntimeCodexCredentials,
  resolveCodexApiCredentials,
  parseOpenAICompatibleApiFormat,
} from './providerResolution.js'

export {
  registerProviderSettingsGetter,
  resolveProviderOverrideForModel,
} from './agentRouting.js'

import {
  isCodexRefreshFailureCoolingDown,
} from '../../utils/codexCredentials.js'
import {
  CODEX_ALIAS_MODELS,
  type ReasoningEffort,
  type CodexAlias,
} from '../../utils/model/modelDescriptor.js'

export function isCodexApiCoolingDown(): boolean {
  return isCodexRefreshFailureCoolingDown()
}

export function getReasoningEffortForModel(model: string): ReasoningEffort | undefined {
  const normalized = model.trim().toLowerCase()
  const base = normalized.split('?', 1)[0] ?? normalized
  const alias = base as CodexAlias
  const aliasConfig = (CODEX_ALIAS_MODELS as any)[alias]
  return aliasConfig?.reasoningEffort
}

export function supportsCodexReasoningEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  const base = normalized.split('?', 1)[0] ?? normalized

  if (base === 'gpt-5.3-codex-spark' || base === 'codexspark') {
    return false
  }

  if (getReasoningEffortForModel(base) !== undefined) {
    return true
  }

  return /^gpt-5(?:[.-]|$)/.test(base)
}
