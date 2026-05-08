// biome-ignore-all assist/source/organizeImports: internal-only import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import { getAdditionalModelOptionsCacheScope } from '../../services/api/providerConfig.js'
import {
  isClaudeAISubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import { formatModelPricingForModel } from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getClaudeAiUserDefaultModelDescription,
  getDefaultSonnetModel,
  getDefaultOpusModel,
  getDefaultHaikuModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  getOpus46PricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'
import {
  getActiveOpenAIModelOptionsCache,
  getActiveProviderProfile,
  getProfileModelOptions,
} from '../providerProfiles.js'
import {
  getDefaultModelForProvider,
  getModelMetadata,
  getModelOptions as getCatalogModelOptions,
} from '../../integrations/modelCatalog/catalog.js'
import { getCachedOllamaModelOptions, isOllamaProvider } from './ollamaModels.js'
import { isNvidiaNimProvider } from './nvidiaNimModels.js'
import { isMiniMaxProvider } from './minimaxModels.js'
import { getAntModels } from './antModels.js'

// Model metadata source of truth: src/integrations/modelCatalog/providers/*.json

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

function getAnthropicPricingSuffix(model: string): string {
  if (getAPIProvider() !== 'firstParty') {
    return ''
  }
  const pricing = formatModelPricingForModel(model, { providerId: 'anthropic' })
  return pricing ? ` · ${pricing}` : ''
}

function stripClaudePrefix(label: string): string {
  return label.replace(/^Claude\s+/i, '')
}

function getAnthropicModelDisplayName(model: string): string {
  const metadata = getModelMetadata(model.replace(/\[1m\]$/i, ''), 'anthropic')
  return stripClaudePrefix(metadata?.ui?.marketingName ?? metadata?.label ?? model)
}

function getAnthropicFamilyLabel(model: string): string {
  const metadata = getModelMetadata(model.replace(/\[1m\]$/i, ''), 'anthropic')
  if (metadata?.family) {
    return metadata.family[0]!.toUpperCase() + metadata.family.slice(1)
  }

  return getAnthropicModelDisplayName(model).split(/\s+/)[0] ?? model
}

function getAnthropicContextOptionLabel(model: string): string {
  return `${getAnthropicFamilyLabel(model)} (1M context)`
}

function getScopedAdditionalModelOptions(): ModelOption[] {
  const config = getGlobalConfig()
  const activeScope = getAdditionalModelOptionsCacheScope()

  if (!activeScope) {
    return []
  }

  if (config.additionalModelOptionsCacheScope !== undefined) {
    return config.additionalModelOptionsCacheScope === activeScope
      ? (config.additionalModelOptionsCache ?? [])
      : []
  }

  return activeScope === 'firstParty'
    ? (config.additionalModelOptionsCache ?? [])
    : []
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'

  if (process.env.USER_TYPE === 'ant') {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model for Ants (currently ${currentModel})`,
      descriptionForModel: `Default model (currently ${currentModel})`,
    }
  }

  if (is3P) {
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`,
    }
  }

  // Subscribers
  if (isClaudeAISubscriber()) {
    return {
      value: null,
      label: 'Default (recommended)',
      description: getClaudeAiUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  return {
    value: null,
    label: 'Default (recommended)',
    description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${getAnthropicPricingSuffix(getDefaultSonnetModel())}`,
  }
}

function getCustomSonnetOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customSonnetModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  // When a 3P user has a custom sonnet model string, show it directly
  if (is3P && customSonnetModel) {
    const is1m = has1mContext(customSonnetModel)
    return {
      value: 'sonnet',
      label:
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME ?? customSonnetModel,
      description:
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION ??
        `Custom Sonnet model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION ?? `Custom Sonnet model${is1m ? ' with 1M context' : ''}`} (${customSonnetModel})`,
    }
  }
}

// Provider catalog owns model facts; first-party aliases remain compatibility logic here.
function getSonnet46Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().sonnet46
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: is3P ? model : 'sonnet',
    label: getAnthropicFamilyLabel(model),
    description: `${displayName} · Best for everyday tasks${getAnthropicPricingSuffix(model)}`,
    descriptionForModel:
      `${displayName} - best for everyday tasks. Generally recommended for most coding tasks`,
  }
}

function getCustomOpusOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customOpusModel = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  // When a 3P user has a custom opus model string, show it directly
  if (is3P && customOpusModel) {
    const is1m = has1mContext(customOpusModel)
    return {
      value: 'opus',
      label: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME ?? customOpusModel,
      description:
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION ??
        `Custom Opus model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION ?? `Custom Opus model${is1m ? ' with 1M context' : ''}`} (${customOpusModel})`,
    }
  }
}

function getOpus41Option(): ModelOption {
  const model = getModelStrings().opus41
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: 'opus',
    label: displayName,
    description: `${displayName} · Legacy`,
    descriptionForModel: `${displayName} - legacy version`,
  }
}

function getOpus47Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus47
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: is3P ? model : 'opus',
    label: getAnthropicFamilyLabel(model),
    description: `${displayName} · Most capable for complex work${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel: `${displayName} - most capable for complex work`,
  }
}

function getOpus46Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus46
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: is3P ? model : 'opus',
    label: getAnthropicFamilyLabel(model),
    description: `${displayName} · Most capable for complex work${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel: `${displayName} - most capable for complex work`,
  }
}

export function getSonnet46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().sonnet46
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: is3P ? model + '[1m]' : 'sonnet[1m]',
    label: getAnthropicContextOptionLabel(model),
    description: `${displayName} for long sessions${getAnthropicPricingSuffix(model)}`,
    descriptionForModel:
      `${displayName} with 1M context window - for long sessions with large codebases`,
  }
}

export function getOpus46_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus46
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: is3P ? model + '[1m]' : 'opus[1m]',
    label: getAnthropicContextOptionLabel(model),
    description: `${displayName} for long sessions${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel:
      `${displayName} with 1M context window - for long sessions with large codebases`,
  }
}

function getCustomHaikuOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customHaikuModel = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  // When a 3P user has a custom haiku model string, show it directly
  if (is3P && customHaikuModel) {
    return {
      value: 'haiku',
      label: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME ?? customHaikuModel,
      description:
        process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION ??
        'Custom Haiku model',
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION ?? 'Custom Haiku model'} (${customHaikuModel})`,
    }
  }
}

function getHaiku45Option(): ModelOption {
  const model = getModelStrings().haiku45
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: 'haiku',
    label: getAnthropicFamilyLabel(model),
    description: `${displayName} · Fastest for quick answers${getAnthropicPricingSuffix(model)}`,
    descriptionForModel:
      `${displayName} - fastest for quick answers. Lower cost but less capable than ${getAnthropicModelDisplayName(getModelStrings().sonnet46)}.`,
  }
}

function getHaiku35Option(): ModelOption {
  const model = getModelStrings().haiku35
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: 'haiku',
    label: getAnthropicFamilyLabel(model),
    description: `${displayName} for simple tasks${getAnthropicPricingSuffix(model)}`,
    descriptionForModel:
      `${displayName} - faster and lower cost, but less capable than ${getAnthropicFamilyLabel(getModelStrings().sonnet46)}. Use for simple tasks.`,
  }
}

function getHaikuOption(): ModelOption {
  // Return correct Haiku option based on provider
  const haikuModel = getDefaultHaikuModel()
  return haikuModel === getModelStrings().haiku45
    ? getHaiku45Option()
    : getHaiku35Option()
}

function getMaxOpusOption(fastMode = false): ModelOption {
  const model = getDefaultOpusModel()
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: 'opus',
    label: getAnthropicFamilyLabel(model),
    description: `${displayName} · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`,
  }
}

export function getMaxSonnet46_1MOption(): ModelOption {
  const model = getDefaultSonnetModel()
  const displayName = getAnthropicModelDisplayName(model)
  const billingInfo = isClaudeAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'sonnet[1m]',
    label: getAnthropicContextOptionLabel(model),
    description: `${displayName} with 1M context${billingInfo}${getAnthropicPricingSuffix(model)}`,
  }
}

export function getMaxOpus46_1MOption(fastMode = false): ModelOption {
  const model = getModelStrings().opus46
  const displayName = getAnthropicModelDisplayName(model)
  const billingInfo = isClaudeAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'opus[1m]',
    label: getAnthropicContextOptionLabel(model),
    description: `${displayName} with 1M context${billingInfo}${getOpus46PricingSuffix(fastMode)}`,
  }
}

function getMergedOpus1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = is3P ? getModelStrings().opus46 : getDefaultOpusModel()
  const displayName = getAnthropicModelDisplayName(model)
  return {
    value: is3P ? model + '[1m]' : 'opus[1m]',
    label: getAnthropicContextOptionLabel(model),
    description: `${displayName} with 1M context · Most capable for complex work${!is3P && fastMode ? getOpus46PricingSuffix(fastMode) : ''}`,
    descriptionForModel:
      `${displayName} with 1M context - most capable for complex work`,
  }
}

function getMaxSonnetOption(): ModelOption {
  const model = getDefaultSonnetModel()
  return {
    value: 'sonnet',
    label: getAnthropicFamilyLabel(model),
    description: `${getAnthropicModelDisplayName(model)} · Best for everyday tasks`,
  }
}

function getMaxHaikuOption(): ModelOption {
  const model = getDefaultHaikuModel()
  return {
    value: 'haiku',
    label: getAnthropicFamilyLabel(model),
    description: `${getAnthropicModelDisplayName(model)} · Fastest for quick answers`,
  }
}

function getOpusPlanOption(): ModelOption {
  const opus = getAnthropicModelDisplayName(getDefaultOpusModel())
  const sonnet = getAnthropicModelDisplayName(getDefaultSonnetModel())
  return {
    value: 'opusplan',
    label: 'Opus Plan Mode',
    description: `Use ${opus} in plan mode, ${sonnet} otherwise`,
  }
}

function getCodexPlanOption(): ModelOption {
  const model =
    getDefaultModelForProvider('codex', 'main') ??
    getDefaultModelForProvider('codex') ??
    ''
  const metadata = getModelMetadata(model, 'codex')
  return {
    value: model,
    label: metadata?.ui?.pickerLabel ?? metadata?.label ?? model,
    description:
      metadata?.ui?.pickerDescription ??
      `${metadata?.label ?? model} on the Codex backend with high reasoning`,
  }
}

function getCodexSparkOption(): ModelOption {
  const model =
    getDefaultModelForProvider('codex', 'smallFast') ??
    getDefaultModelForProvider('codex') ??
    ''
  const metadata = getModelMetadata(model, 'codex')
  return {
    value: model,
    label: metadata?.ui?.pickerLabel ?? metadata?.label ?? model,
    description:
      metadata?.ui?.pickerDescription ??
      `${metadata?.label ?? model} on the Codex backend for fast tool loops`,
  }
}

function getCodexModelOptions(): ModelOption[] {
  return getCatalogModelOptions('codex', 'thirdParty')
}

function getCopilotModelOptions(): ModelOption[] {
  return getCatalogModelOptions('github-copilot', 'thirdParty').map(option => ({
    value: option.value,
    label: option.label,
    description: option.description,
    descriptionForModel: option.descriptionForModel,
  }))
}

// Provider catalog owns third-party model facts; picker ordering still bridges legacy UI branches.

function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (getAPIProvider() === 'github') {
    return [getDefaultOptionForUser(fastMode), ...getCopilotModelOptions()]
  }

  // When using Ollama, show models from the Ollama server instead of Claude models
  if (getAPIProvider() === 'openai' && isOllamaProvider()) {
    const defaultOption = getDefaultOptionForUser(fastMode)
    const ollamaModels = getCachedOllamaModelOptions()
    if (ollamaModels.length > 0) {
      return [defaultOption, ...ollamaModels]
    }
    // Fallback: if models not yet fetched, show current model instead of Claude models
    const currentModel = getUserSpecifiedModelSetting() ?? getInitialMainLoopModel()
    if (currentModel != null) {
      return [
        defaultOption,
        {
          value: currentModel,
          label: currentModel,
          description: 'Currently configured Ollama model',
        },
      ]
    }
    return [defaultOption]
  }

  // When using NVIDIA NIM, show models from the NVIDIA catalog
  if (isNvidiaNimProvider()) {
    const defaultOption = getDefaultOptionForUser(fastMode)
    const nvidiaModels = getCatalogModelOptions('nvidia-nim', 'thirdParty')
    if (nvidiaModels.length > 0) {
      return [defaultOption, ...nvidiaModels]
    }
    return [defaultOption]
  }

  // When using MiniMax, show models from the MiniMax catalog
  if (isMiniMaxProvider()) {
    const defaultOption = getDefaultOptionForUser(fastMode)
    const minimaxModels = getCatalogModelOptions('minimax', 'thirdParty')
    if (minimaxModels.length > 0) {
      return [defaultOption, ...minimaxModels]
    }
    return [defaultOption]
  }

  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[internal] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...antModelOptions,
      getMergedOpus1MOption(fastMode),
      getSonnet46Option(),
      getSonnet46_1MOption(),
      getHaiku45Option(),
    ]
  }

  if (isClaudeAISubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: Opus is default, show Sonnet as alternative
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      if (!isOpus1mMergeEnabled() && checkOpus1mAccess()) {
        premiumOptions.push(getMaxOpus46_1MOption(fastMode))
      }

      premiumOptions.push(getMaxSonnetOption())
      if (checkSonnet1mAccess()) {
        premiumOptions.push(getMaxSonnet46_1MOption())
      }

      premiumOptions.push(getMaxHaikuOption())
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: Sonnet is default, show Opus as alternative
    const standardOptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      standardOptions.push(getMaxSonnet46_1MOption())
    }

    if (isOpus1mMergeEnabled()) {
      standardOptions.push(getMergedOpus1MOption(fastMode))
    } else {
      standardOptions.push(getMaxOpusOption(fastMode))
      if (checkOpus1mAccess()) {
        standardOptions.push(getMaxOpus46_1MOption(fastMode))
      }
    }

    standardOptions.push(getMaxHaikuOption())
    return standardOptions
  }

  if (getAdditionalModelOptionsCacheScope()?.startsWith('openai:')) {
    const activeOpenAIOptions = getActiveOpenAIModelOptionsCache()
    return [
      getDefaultOptionForUser(fastMode),
      ...(activeOpenAIOptions.length > 0
        ? activeOpenAIOptions
        : getScopedAdditionalModelOptions()),
    ]
  }

  // When a provider profile's env is applied, collect its models so they
  // can be appended to the standard picker options below.
  // We check PROFILE_ENV_APPLIED to avoid the ?? profiles[0] fallback in
  // getActiveProviderProfile which would affect users with inactive profiles.
  const profileEnvApplied = process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1'
  const profileModelOptions: ModelOption[] = []
  if (profileEnvApplied) {
    const activeProfile = getActiveProviderProfile()
    if (activeProfile) {
      const models = getProfileModelOptions(activeProfile)
      profileModelOptions.push(...models)
    }
  }

  // PAYG 1P API: default + configured 1M/default family alternatives.
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      payg1POptions.push(getSonnet46_1MOption())
    }
    if (isOpus1mMergeEnabled()) {
      payg1POptions.push(getMergedOpus1MOption(fastMode))
    } else {
      payg1POptions.push(getOpus47Option(fastMode))
      payg1POptions.push(getOpus46Option(fastMode))
      if (checkOpus1mAccess()) {
        payg1POptions.push(getOpus46_1MOption(fastMode))
      }
    }
    payg1POptions.push(getHaiku45Option())
    payg1POptions.push(...profileModelOptions)
    return payg1POptions
  }

  // PAYG 3P: default + configured family alternatives, preserving custom env overrides.
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  // Add Codex models for openai and codex providers
  if (getAPIProvider() === 'openai' || getAPIProvider() === 'codex') {
    payg3pOptions.push(...getCodexModelOptions())
  }

  const customSonnet = getCustomSonnetOption()
  if (customSonnet !== undefined) {
    payg3pOptions.push(customSonnet)
  } else {
    // Add the current Sonnet alternative when no custom Sonnet override is set.
    payg3pOptions.push(getSonnet46Option())
    if (checkSonnet1mAccess()) {
      payg3pOptions.push(getSonnet46_1MOption())
    }
  }

  const customOpus = getCustomOpusOption()
  if (customOpus !== undefined) {
    payg3pOptions.push(customOpus)
  } else {
    // Add the legacy and current Opus alternatives.
    payg3pOptions.push(getOpus41Option())
    payg3pOptions.push(getOpus47Option(fastMode))
    payg3pOptions.push(getOpus46Option(fastMode))
    if (checkOpus1mAccess()) {
      payg3pOptions.push(getOpus46_1MOption(fastMode))
    }
  }
  const customHaiku = getCustomHaikuOption()
  if (customHaiku !== undefined) {
    payg3pOptions.push(customHaiku)
  } else {
    payg3pOptions.push(getHaikuOption())
  }
  payg3pOptions.push(...profileModelOptions)
  return payg3pOptions
}

// Provider catalog owns model facts; legacy upgrade hints still map pinned names to family aliases here.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)
  const metadata = getModelMetadata(canonical, 'anthropic')
  const alias = metadata?.ui?.upgradeHintFamily
  const defaultModel =
    metadata?.family === 'opus'
      ? getDefaultOpusModel()
      : metadata?.family === 'sonnet'
        ? getDefaultSonnetModel()
        : metadata?.family === 'haiku'
          ? getDefaultHaikuModel()
          : undefined

  if (alias && defaultModel) {
    const currentName = getMarketingNameForModel(defaultModel)
    if (currentName) {
      return { alias, currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known Anthropic model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  if (getAPIProvider() === 'github') {
    return filterModelOptionsByAllowlist(getModelOptionsBase(fastMode))
  }

  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the ANTHROPIC_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Append additional model options fetched during bootstrap
  for (const opt of getScopedAdditionalModelOptions()) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'opusplan') {
    return filterModelOptionsByAllowlist([...options, getOpusPlanOption()])
  } else if (customModel === getDefaultModelForProvider('codex', 'main')) {
    return filterModelOptionsByAllowlist([...options, getCodexPlanOption()])
  } else if (customModel === getDefaultModelForProvider('codex', 'smallFast')) {
    return filterModelOptionsByAllowlist([...options, getCodexSparkOption()])
  } else if (customModel === 'opus' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxOpusOption(fastMode),
    ])
  } else if (customModel === 'opus[1m]' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedOpus1MOption(fastMode),
    ])
  } else {
    // Try to show a human-readable label for known Anthropic models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  const filtered = !settings.availableModels
    ? options // No restrictions
    : options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )

  // Select state uses option values as identity keys. If two entries share the
  // same value (e.g. provider-specific aliases collapsing to one model ID),
  // navigation/focus can become inconsistent and appear as duplicate rendering.
  const seen = new Set<string>()
  return filtered.filter(opt => {
    const key = String(opt.value)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
