// biome-ignore-all assist/source/organizeImports: internal-only import markers must not be reordered
/**
 * Ensure that any model codenames introduced here are also added to
 * scripts/excluded-strings.txt to avoid leaking them. Wrap any codename string
 * literals with process.env.USER_TYPE === 'ant' for Bun to remove the codenames
 * during dead code elimination
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import {
  getSubscriptionType,
  isClaudeAISubscriber,
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import {
  has1mContext,
  is1mContextDisabled,
  modelSupports1M,
} from '../context.js'
import { isEnvTruthy } from '../envUtils.js'
import { getModelStrings, resolveOverriddenModel } from './modelStrings.js'
import { formatModelPricing, getOpus46CostTier } from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getAPIProvider } from './providers.js'
import { LIGHTNING_BOLT } from '../../constants/figures.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias, isModelAlias } from './aliases.js'
import { capitalize } from '../stringUtils.js'
import { DEFAULT_GEMINI_MODEL } from '../providerProfile.js'
import {
  getAllModelsForProvider,
  getDefaultModelForProvider,
  getModelMetadata,
} from '../../integrations/modelCatalog/catalog.js'
import type { ModelDefaultRole } from '../../integrations/modelCatalog/types.js'
import {
  getAntModelOverrideConfig,
  resolveAntModel,
} from './antModels.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

function normalizeModelSetting(value: unknown): ModelName | ModelAlias | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getCatalogProviderForLegacyProvider(): string | undefined {
  const provider = getAPIProvider()
  switch (provider) {
    case 'firstParty':
      return 'anthropic'
    case 'bedrock':
    case 'vertex':
    case 'foundry':
      return provider
    case 'openai':
    case 'gemini':
    case 'mistral':
    case 'codex':
    case 'nvidia-nim':
    case 'minimax':
    case 'xai':
      return provider
    case 'github':
      return 'github-copilot'
    default:
      return undefined
  }
}

function getProviderDefaultModel(role: ModelDefaultRole): string | undefined {
  const providerId = getCatalogProviderForLegacyProvider()
  return providerId ? getDefaultModelForProvider(providerId, role) : undefined
}

function getAnthropicCatalogCanonicalName(
  name: ModelName,
): ModelShortName | undefined {
  const normalizedName = name.toLowerCase()
  const candidates = getAllModelsForProvider('anthropic')
    .flatMap(model => [
      { canonical: model.id, value: model.id },
      { canonical: model.id, value: model.apiName },
      { canonical: model.id, value: model.canonicalModelId },
      ...(model.compatibility?.legacyIds ?? []).map(value => ({
        canonical: model.id,
        value,
      })),
    ])
    .filter(
      (candidate): candidate is { canonical: string; value: string } =>
        typeof candidate.value === 'string' && candidate.value.length > 0,
    )
    .sort((left, right) => right.value.length - left.value.length)

  return candidates.find(candidate =>
    normalizedName.includes(candidate.value.toLowerCase()),
  )?.canonical
}

export function getSmallFastModel(): ModelName {
  if (process.env.ANTHROPIC_SMALL_FAST_MODEL) return process.env.ANTHROPIC_SMALL_FAST_MODEL
  // For Gemini provider, use a fast model
  if (getAPIProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || getProviderDefaultModel('smallFast') || DEFAULT_GEMINI_MODEL
  }
  if (getAPIProvider() === 'mistral') {
    return process.env.MISTRAL_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  // For OpenAI provider, use OPENAI_MODEL or a sensible default
  if (getAPIProvider() === 'openai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  // Codex provider — OPENAI_MODEL is always set for Codex profiles; only fall
  // back to a codex-spark alias when an override env strips it.
  if (getAPIProvider() === 'codex') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  // For GitHub Copilot provider
  if (getAPIProvider() === 'github') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  // NVIDIA NIM — OPENAI_MODEL carries the user's active NIM model; use a
  // small Meta Llama variant as the conservative fallback.
  if (getAPIProvider() === 'nvidia-nim') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  // MiniMax — OPENAI_MODEL carries the active MiniMax model; fall back to
  // the fastest tier (M2.5-highspeed) when missing.
  if (getAPIProvider() === 'minimax') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  // xAI — OPENAI_MODEL carries the active Grok model; fall back to grok-3.
  if (getAPIProvider() === 'xai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('smallFast') || getModelStrings().haiku45
  }
  return getDefaultHaikuModel()
}

export function isNonCustomOpusModel(model: ModelName): boolean {
  const metadata = getModelMetadata(model, 'anthropic')
  return metadata?.id.includes('-opus-') ?? false
}

/**
 * Helper to get the model from /model (including via /config), the --model flag, environment variable,
 * or the saved settings. The returned value can be a model alias if that's what the user specified.
 * Undefined if the user didn't configure anything, in which case we fall back to
 * the default (null).
 *
 * Priority order within this function:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. ANTHROPIC_MODEL environment variable
 * 4. Settings (from user's saved settings)
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    const setting = normalizeModelSetting(settings.model)
    // Read the model env var that matches the active provider to prevent
    // cross-provider leaks (e.g. ANTHROPIC_MODEL sent to the OpenAI API).
    //
    // All OpenAI-shim providers (openai, codex, github, nvidia-nim, minimax)
    // set CLAUDE_CODE_USE_OPENAI=1 + OPENAI_MODEL via
    // applyProviderProfileToProcessEnv. Earlier this check only included
    // openai/github — codex/nvidia-nim/minimax fell through to the stale
    // settings.model, so switching from (say) Moonshot to Codex kept firing
    // `kimi-k2.6` at the Codex endpoint and getting 400s.
    const provider = getAPIProvider()
    const isOpenAIShimProvider =
      provider === 'openai' ||
      provider === 'codex' ||
      provider === 'github' ||
      provider === 'nvidia-nim' ||
      provider === 'minimax' ||
      provider === 'xai'
    specifiedModel =
      (provider === 'gemini' ? process.env.GEMINI_MODEL : undefined) ||
      (provider === 'mistral' ? process.env.MISTRAL_MODEL : undefined) ||
      (isOpenAIShimProvider ? process.env.OPENAI_MODEL : undefined) ||
      (provider === 'firstParty' ? process.env.ANTHROPIC_MODEL : undefined) ||
      setting ||
      undefined
  }

  // Ignore the user-specified model if it's not in the availableModels allowlist.
  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}

/**
 * Get the main loop model to use for the current session.
 *
 * Model Selection Priority Order:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. ANTHROPIC_MODEL environment variable
 * 4. Settings (from user's saved settings)
 * 5. Built-in default
 *
 * @returns The resolved model name to use
 */
export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getBestModel(): ModelName {
  return getDefaultOpusModel()
}

// Provider-specific Opus defaults come from catalog visibility.defaultFor.
export function getDefaultOpusModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  }
  // Gemini provider
  if (getAPIProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || getProviderDefaultModel('opus') || DEFAULT_GEMINI_MODEL
  }
  // Mistral provider
  if (getAPIProvider() === 'mistral') {
    return process.env.MISTRAL_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // OpenAI provider: use user-specified model or default
  if (getAPIProvider() === 'openai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // Codex provider: use user-specified model or default to gpt-5.5
  if (getAPIProvider() === 'codex') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // GitHub Copilot provider
  if (getAPIProvider() === 'github') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // NVIDIA NIM
  if (getAPIProvider() === 'nvidia-nim') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // MiniMax — flagship tier for "opus"-equivalent.
  if (getAPIProvider() === 'minimax') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // xAI — flagship Grok model for "opus"-equivalent.
  if (getAPIProvider() === 'xai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('opus') || getDefaultSonnetModel()
  }
  // 3P providers (Bedrock, Vertex, Foundry) — kept as a separate branch
  // since 3P availability lags firstParty and these will diverge again at
  // the next model launch. Keep 3P on Opus 4.6 until they roll out 4.7.
  if (getAPIProvider() !== 'firstParty') {
    return getProviderDefaultModel('opus') || getModelStrings().opus46
  }
  return getProviderDefaultModel('opus') || getModelStrings().opus47
}

// Provider-specific Sonnet defaults come from catalog visibility.defaultFor.
export function getDefaultSonnetModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  }
  // Gemini provider
  if (getAPIProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || getProviderDefaultModel('sonnet') || DEFAULT_GEMINI_MODEL
  }
  // Mistral provider
  if (getAPIProvider() === 'mistral') {
    return process.env.MISTRAL_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // OpenAI provider
  if (getAPIProvider() === 'openai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // Codex provider
  if (getAPIProvider() === 'codex') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // GitHub Copilot provider
  if (getAPIProvider() === 'github') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // NVIDIA NIM
  if (getAPIProvider() === 'nvidia-nim') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // MiniMax — mid tier for "sonnet"-equivalent.
  if (getAPIProvider() === 'minimax') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // xAI — flagship Grok model for "sonnet"-equivalent.
  if (getAPIProvider() === 'xai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('sonnet') || getDefaultHaikuModel()
  }
  // Default to Sonnet 4.5 for 3P since they may not have 4.6 yet
  if (getAPIProvider() !== 'firstParty') {
    return getProviderDefaultModel('sonnet') || getModelStrings().sonnet45
  }
  return getProviderDefaultModel('sonnet') || getModelStrings().sonnet46
}

// Provider-specific Haiku defaults come from catalog visibility.defaultFor.
export function getDefaultHaikuModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  }
  // Mistral provider
  if (getAPIProvider() === 'mistral') {
    return process.env.MISTRAL_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }
  // OpenAI provider
  if (getAPIProvider() === 'openai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }
  // Codex provider
  if (getAPIProvider() === 'codex') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }
  // GitHub Copilot provider
  if (getAPIProvider() === 'github') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }
  // Gemini provider
  if (getAPIProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || getProviderDefaultModel('haiku') || DEFAULT_GEMINI_MODEL
  }
  // NVIDIA NIM
  if (getAPIProvider() === 'nvidia-nim') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }
  // MiniMax — fastest tier for "haiku"-equivalent.
  if (getAPIProvider() === 'minimax') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }
  // xAI — faster Grok model for "haiku"-equivalent.
  if (getAPIProvider() === 'xai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('haiku') || getModelStrings().haiku45
  }

  // Haiku 4.5 is available on all platforms (first-party, Foundry, Bedrock, Vertex)
  return getProviderDefaultModel('haiku') || getModelStrings().haiku45
}

/**
 * Get the model to use for runtime, depending on the runtime context.
 * @param params Subset of the runtime context to determine the model to use.
 * @returns The model to use
 */
export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  const { permissionMode, mainLoopModel, exceeds200kTokens = false } = params

  // opusplan uses Opus in plan mode without [1m] suffix.
  if (
    getUserSpecifiedModelSetting() === 'opusplan' &&
    permissionMode === 'plan' &&
    !exceeds200kTokens
  ) {
    return getDefaultOpusModel()
  }

  // sonnetplan by default
  if (getUserSpecifiedModelSetting() === 'haiku' && permissionMode === 'plan') {
    return getDefaultSonnetModel()
  }

  return mainLoopModel
}

/**
 * Get the default main loop model setting.
 *
 * This handles the built-in default:
 * - Opus for Max and Team Premium users
 * - Sonnet 4.6 for all other users (including Team Standard, Pro, Enterprise)
 *
 * @returns The default model setting to use
 */
export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  // GitHub Copilot provider: check settings.model first, then env, then default
  if (getAPIProvider() === 'github') {
    const settings = getSettings_DEPRECATED() || {}
    return (
      normalizeModelSetting(settings.model) ||
      normalizeModelSetting(process.env.OPENAI_MODEL) ||
      getProviderDefaultModel('main') ||
      ''
    )
  }
  // Gemini provider: always use the configured Gemini model
  if (getAPIProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || getProviderDefaultModel('main') || DEFAULT_GEMINI_MODEL
  }
  if (getAPIProvider() === 'mistral') {
    return process.env.MISTRAL_MODEL || getProviderDefaultModel('main') || getDefaultSonnetModel()
  }
  // OpenAI provider: always use the configured OpenAI model
  if (getAPIProvider() === 'openai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('main') || getDefaultSonnetModel()
  }
  // Codex provider: always use the configured Codex model (default gpt-5.5)
  if (getAPIProvider() === 'codex') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('main') || getDefaultSonnetModel()
  }
  // xAI provider: always use the configured Grok model (default grok-4)
  if (getAPIProvider() === 'xai') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('main') || getDefaultSonnetModel()
  }
  // MiniMax provider: always use the configured MiniMax model
  if (getAPIProvider() === 'minimax') {
    return process.env.OPENAI_MODEL || getProviderDefaultModel('main') || getDefaultSonnetModel()
  }

  // Ants default to defaultModel from flag config, or Opus 1M if not configured
  if (process.env.USER_TYPE === 'ant') {
    return (
      getAntModelOverrideConfig()?.defaultModel ??
      getDefaultOpusModel() + '[1m]'
    )
  }

  // Max users get Opus as default
  if (isMaxSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  // Team Premium gets Opus (same as Max)
  if (isTeamPremiumSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  // PAYG (1P and 3P), Enterprise, Team Standard, and Pro get Sonnet as default
  // Note that PAYG (3P) may default to an older Sonnet model
  return getDefaultSonnetModel()
}

/**
 * Synchronous operation to get the default main loop model to use
 * (bypassing any user-specified values).
 */
export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

// Catalog entries are the source of truth; this remains a legacy substring fallback.
/**
 * Pure string-match that strips date/provider suffixes from a first-party model
 * name. Input must already be a 1P-format ID (for example, a dated first-party
 * ID or a provider-prefixed Bedrock ID). Does not touch settings, so safe at
 * module top-level (see MODEL_COSTS in modelCost.ts).
 */
export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  name = name.toLowerCase()
  const catalogCanonicalName = getAnthropicCatalogCanonicalName(name)
  if (catalogCanonicalName) {
    return catalogCanonicalName
  }
  const match = name.match(/(claude-(\d+-\d+-)?\w+)/)
  if (match && match[1]) {
    return match[1]
  }
  // Fall back to the original name if no pattern matches
  return name
}

/**
 * Maps a full model string to a shorter canonical version that's unified across 1P and 3P providers.
 * For example, 'claude-3-5-haiku-20241022' and 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
 * would both be mapped to 'claude-3-5-haiku'.
 * @param fullModelName The full model name (e.g., 'claude-3-5-haiku-20241022')
 * @returns The short name (e.g., 'claude-3-5-haiku') if found, or the original name if no mapping exists
 */
export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  // Resolve overridden model IDs (e.g. Bedrock ARNs) back to canonical names.
  // resolved is always a 1P-format ID, so firstPartyNameToCanonical can handle it.
  return firstPartyNameToCanonical(resolveOverriddenModel(fullModelName))
}

// Catalog labels own model names; this only formats subscription-specific default copy.
export function getClaudeAiUserDefaultModelDescription(
  fastMode = false,
): string {
  const opusModel = getDefaultOpusModel()
  const opusName = isOpus1mMergeEnabled()
    ? getCatalogModelDisplayName(`${opusModel}[1m]`, 'anthropic')
    : getCatalogModelDisplayName(opusModel, 'anthropic')
  const inlineOpusName = opusName?.replace(
    ' (1M context)',
    ' with 1M context',
  )
  const sonnetName = getCatalogModelDisplayName(
    getDefaultSonnetModel(),
    'anthropic',
  )

  if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
    if (isOpus1mMergeEnabled()) {
      return `${inlineOpusName ?? 'Opus with 1M context'} · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
    }
    return `${inlineOpusName ?? 'Opus'} · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
  }
  return `${sonnetName ?? 'Sonnet'} · Best for everyday tasks`
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias,
): string {
  if (setting === 'opusplan') {
    const opusName =
      getCatalogModelDisplayName(
        getDefaultModelForProvider('anthropic', 'opus') ?? 'opus',
        'anthropic',
      ) ?? 'Opus'
    const sonnetName =
      getCatalogModelDisplayName(
        getDefaultModelForProvider('anthropic', 'sonnet') ?? 'sonnet',
        'anthropic',
      ) ?? 'Sonnet'
    return `${opusName} in plan mode, else ${sonnetName}`
  }
  return renderModelName(parseUserSpecifiedModel(setting))
}

export function getOpus46PricingSuffix(fastMode: boolean): string {
  if (getAPIProvider() !== 'firstParty') return ''
  const pricing = formatModelPricing(getOpus46CostTier(fastMode))
  const fastModeIndicator = fastMode ? ` (${LIGHTNING_BOLT})` : ''
  return ` ·${fastModeIndicator} ${pricing}`
}

export function isOpus1mMergeEnabled(): boolean {
  if (
    is1mContextDisabled() ||
    isProSubscriber() ||
    getAPIProvider() !== 'firstParty'
  ) {
    return false
  }
  // Fail closed when a subscriber's subscription type is unknown. The VS Code
  // config-loading subprocess can have OAuth tokens with valid scopes but no
  // subscriptionType field (stale or partial refresh). Without this guard,
  // isProSubscriber() returns false for such users and the merge leaks
  // opus[1m] into the model dropdown — the API then rejects it with a
  // misleading "rate limit reached" error.
  if (isClaudeAISubscriber() && getSubscriptionType() === null) {
    return false
  }
  return true
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Opus Plan'
  }
  // Handle Codex models - show actual model name + resolved model
  if (setting === 'codexplan') {
    return `codexplan (${getDefaultModelForProvider('codex', 'main') ?? ''})`
  }
  if (setting === 'codexspark') {
    return `codexspark (${getDefaultModelForProvider('codex', 'smallFast') ?? ''})`
  }
  if (isModelAlias(setting)) {
    return capitalize(setting)
  }
  return renderModelName(setting)
}

function getCatalogModelDisplayName(
  model: ModelName,
  providerId: string,
): string | null {
  const has1mSuffix = /\[1m\]$/i.test(model)
  const baseModel = model.replace(/\[1m\]$/i, '')

  try {
    const metadata = getModelMetadata(baseModel, providerId)
    const label = has1mSuffix
      ? metadata?.contextUpgrade?.label
      : metadata?.ui?.marketingName ?? metadata?.label

    if (!label) {
      return null
    }

    return providerId === 'anthropic'
      ? label.replace(/^Claude\s+/i, '')
      : label
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Ambiguous model lookup ')
    ) {
      return null
    }
    throw error
  }
}

/**
 * Returns a human-readable display name for known public models, or null
 * if the model is not recognized as a public model.
 */
export function getPublicModelDisplayName(model: ModelName): string | null {
  // Catalog labels are the source of truth for public/provider model names.
  // First-party Claude labels intentionally omit the leading "Claude" here
  // because commit attribution adds it when needed.
  const providerId = getCatalogProviderForLegacyProvider()
  if (providerId) {
    const providerDisplayName = getCatalogModelDisplayName(model, providerId)
    if (providerDisplayName) {
      return providerDisplayName
    }
  }

  const anthropicDisplayName = getCatalogModelDisplayName(model, 'anthropic')
  if (anthropicDisplayName) {
    return anthropicDisplayName
  }

  switch (model) {
    case 'gpt-5.5':
      return 'GPT-5.5'
    case 'gpt-5.4':
      return 'GPT-5.4'
    case 'gpt-5.3-codex-spark':
      return 'GPT-5.3 Codex Spark'
    default:
      return null
  }
}

function maskModelCodename(baseName: string): string {
  // Mask only the first dash-separated segment (the codename), preserve the rest
  // e.g. capybara-v2-fast → cap*****-v2-fast
  const [codename = '', ...rest] = baseName.split('-')
  const masked =
    codename.slice(0, 3) + '*'.repeat(Math.max(0, codename.length - 3))
  return [masked, ...rest].join('-')
}

export function renderModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName
  }
  // Handle GitHub Copilot special model aliases
  if (model === 'github:copilot') {
    return 'GPT-4o'
  }
  if (process.env.USER_TYPE === 'ant') {
    const resolved = parseUserSpecifiedModel(model)
    const antModel = resolveAntModel(model)
    if (antModel) {
      const baseName = antModel.model.replace(/\[1m\]$/i, '')
      const masked = maskModelCodename(baseName)
      const suffix = has1mContext(resolved) ? '[1m]' : ''
      return masked + suffix
    }
    if (resolved !== model) {
      return `${model} (${resolved})`
    }
    return resolved
  }
  return model
}

/**
 * Returns a safe author name for public display (e.g., in git commit trailers).
 * Returns "Claude {ModelName}" for publicly known models, or "Claude ({model})"
 * for unknown/internal models so the exact model name is preserved.
 *
 * @param model The full model name
 * @returns "Claude {ModelName}" for public models, or "Claude ({model})" for non-public models
 */
export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return `Claude ${publicName}`
  }
  return `Claude (${model})`
}

/**
 * Returns a full model name for use in this session, possibly after resolving
 * a model alias.
 *
 * This function intentionally does not support version numbers to align with
 * the model switcher.
 *
 * Supports [1m] suffix on any model alias (e.g., haiku[1m], sonnet[1m]) to enable
 * 1M context window without requiring each variant to be in MODEL_ALIASES.
 *
 * @param modelInput The model alias or name provided by the user.
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  const modelInputTrimmed = normalizeModelSetting(modelInput)
  if (!modelInputTrimmed) {
    return getDefaultSonnetModel()
  }
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = has1mContext(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  if (isModelAlias(modelString)) {
    switch (modelString) {
      case 'opusplan':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '') // Sonnet is default, Opus in plan mode
      case 'sonnet':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
      case 'haiku':
        return getDefaultHaikuModel() + (has1mTag ? '[1m]' : '')
      case 'opus':
        return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
      case 'best':
        return getBestModel()
      default:
    }
  }

  // Handle Codex aliases - map to actual model names
  if (modelString === 'codexplan') {
    return getDefaultModelForProvider('codex', 'main') ?? ''
  }
  if (modelString === 'codexspark') {
    return getDefaultModelForProvider('codex', 'smallFast') ?? ''
  }

  // Opus 4/4.1 are no longer available on the first-party API (same as
  // Claude.ai) — silently remap to the current Opus default. The 'opus'
  // alias already resolves to 4.6, so the only users on these explicit
  // strings pinned them in settings/env/--model/SDK before 4.5 launched.
  // 3P providers may not yet have 4.6 capacity, so pass through unchanged.
  if (
    getAPIProvider() === 'firstParty' &&
    isLegacyOpusFirstParty(modelString) &&
    isLegacyModelRemapEnabled()
  ) {
    return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
  }

  if (process.env.USER_TYPE === 'ant') {
    const has1mAntTag = has1mContext(normalizedModel)
    const baseAntModel = normalizedModel.replace(/\[1m]$/i, '').trim()

    const antModel = resolveAntModel(baseAntModel)
    if (antModel) {
      const suffix = has1mAntTag ? '[1m]' : ''
      return antModel.model + suffix
    }

    // Fall through to the alias string if we cannot load the config. The API calls
    // will fail with this string, but we should hear about it through feedback and
    // can tell the user to restart/wait for flag cache refresh to get the latest values.
  }

  // Preserve original case for custom model names (e.g., Azure Foundry deployment IDs)
  // Only strip [1m] suffix if present, maintaining case of the base model
  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

/**
 * Resolves a skill's `model:` frontmatter against the current model, carrying
 * the `[1m]` suffix over when the target family supports it.
 *
 * A skill author writing `model: opus` means "use opus-class reasoning" — not
 * "downgrade to 200K". If the user is on opus[1m] at 230K tokens and invokes a
 * skill with `model: opus`, passing the bare alias through drops the effective
 * context window from 1M to 200K, which trips autocompact at 23% apparent usage
 * and surfaces "Context limit reached" even though nothing overflowed.
 *
 * We only carry [1m] when the target actually supports it (sonnet/opus). A skill
 * with `model: haiku` on a 1M session still downgrades — haiku has no 1M variant,
 * so the autocompact that follows is correct. Skills that already specify [1m]
 * are left untouched.
 */
export function resolveSkillModelOverride(
  skillModel: string,
  currentModel: string,
): string {
  if (has1mContext(skillModel) || !has1mContext(currentModel)) {
    return skillModel
  }
  // modelSupports1M matches on canonical IDs; a bare alias falls through
  // getCanonicalName unmatched. Resolve first.
  if (modelSupports1M(parseUserSpecifiedModel(skillModel))) {
    return skillModel + '[1m]'
  }
  return skillModel
}

const LEGACY_OPUS_FIRSTPARTY = [
  'claude-opus-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-opus-4-0',
  'claude-opus-4-1',
]

function isLegacyOpusFirstParty(model: string): boolean {
  return LEGACY_OPUS_FIRSTPARTY.includes(model)
}

/**
 * Opt-out for the legacy Opus 4.0/4.1 → current Opus remap.
 */
export function isLegacyModelRemapEnabled(): boolean {
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP)
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    if (getAPIProvider() !== 'firstParty') {
      return `Default (${getDefaultMainLoopModel()})`
    }
    if (process.env.USER_TYPE === 'ant') {
      return `Default for Ants (${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`
    } else if (isClaudeAISubscriber()) {
      return `Default (${getClaudeAiUserDefaultModelDescription()})`
    }
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

export function getMarketingNameForModel(modelId: string): string | undefined {
  if (getAPIProvider() === 'foundry') {
    // deployment ID is user-defined in Foundry, so it may have no relation to the actual model
    return undefined
  }

  const has1m = modelId.toLowerCase().includes('[1m]')
  const canonical = getCanonicalName(modelId)
  const catalogName =
    getCatalogModelDisplayName(canonical, 'anthropic') ??
    getCatalogModelDisplayName(modelId, 'anthropic')

  if (!catalogName) {
    return undefined
  }

  return has1m
    ? catalogName.replace(' (1M context)', ' (with 1M context)')
    : catalogName
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
