import {
  getGlobalConfig,
  saveGlobalConfig,
  type ProviderProfile as ConfigProviderProfile,
} from '../config.js'
import { hydrateGithubModelsTokenFromSecureStorage } from '../githubModelsCredentials.js'
import { DEFAULT_GEMINI_MODEL, DEFAULT_MISTRAL_MODEL } from '../providerProfile.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  applyProviderProfileToProcessEnv,
  clearProviderProfileEnvFromProcessEnv,
  getProviderProfileSelectionTargetKey,
  getProviderProfiles,
} from '../providerProfiles.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import {
  getPersistedModelSettingForProvider,
  resolveProviderSelectionTarget,
  resolveSettingsModelProvider,
  type ProviderSelectionTarget,
} from './providerModelSettings.js'
import type { APIProvider } from './providers.js'
import { isTeamPremiumSubscriber, isMaxSubscriber } from '../auth.js'
import { getModelStrings } from './modelStrings.js'

export type ProviderSelectionTargetOption = ProviderSelectionTarget & {
  kind: 'builtin' | 'profile'
  label: string
  description: string
  profileId?: string
  profile?: ConfigProviderProfile
}

const BUILTIN_TARGET_KEYS = [
  'firstParty',
  'codex',
  'openai',
  'github',
  'gemini',
  'mistral',
] as const satisfies readonly APIProvider[]

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isBuiltinTargetKey(value: string): value is APIProvider {
  return (BUILTIN_TARGET_KEYS as readonly string[]).includes(value)
}

function getBuiltinTargetLabel(provider: APIProvider): string {
  switch (provider) {
    case 'firstParty':
      return 'Anthropic'
    case 'codex':
      return 'Codex'
    case 'openai':
      return 'OpenAI-compatible'
    case 'github':
      return 'GitHub Models'
    case 'gemini':
      return 'Gemini'
    case 'mistral':
      return 'Mistral'
    case 'bedrock':
      return 'Bedrock'
    case 'vertex':
      return 'Vertex'
    case 'foundry':
      return 'Foundry'
  }
}

function getBuiltinTargetDescription(provider: APIProvider): string {
  switch (provider) {
    case 'firstParty':
      return 'Claude models via Anthropic auth'
    case 'codex':
      return 'GPT-5.x models on the Codex backend'
    case 'openai':
      return 'Generic OpenAI-compatible endpoint'
    case 'github':
      return 'GitHub Models with stored GitHub token'
    case 'gemini':
      return 'Gemini OpenAI-compatible endpoint'
    case 'mistral':
      return 'Mistral OpenAI-compatible endpoint'
    case 'bedrock':
      return 'Anthropic-compatible Bedrock endpoint'
    case 'vertex':
      return 'Anthropic-compatible Vertex endpoint'
    case 'foundry':
      return 'Anthropic-compatible Foundry endpoint'
  }
}

function getFirstPartyDefaultResolvedModel(): string {
  return isMaxSubscriber() || isTeamPremiumSubscriber()
    ? getModelStrings().opus46
    : getModelStrings().sonnet46
}

function getFallbackModelForBuiltinTarget(provider: APIProvider): string | undefined {
  switch (provider) {
    case 'codex':
      return 'gpt-5.4'
    case 'openai':
      return 'gpt-4o'
    case 'github':
      return 'github:copilot'
    case 'gemini':
      return DEFAULT_GEMINI_MODEL
    case 'mistral':
      return DEFAULT_MISTRAL_MODEL
    case 'firstParty':
    case 'bedrock':
    case 'vertex':
    case 'foundry':
      return undefined
  }
}

function resolveProfileTargetOption(
  profile: ConfigProviderProfile,
): ProviderSelectionTargetOption {
  const targetKey = getProviderProfileSelectionTargetKey(profile.id) ?? profile.id
  const provider =
    profile.provider === 'anthropic'
      ? 'firstParty'
      : resolveSettingsModelProvider({
          model: profile.model,
          baseUrl: profile.baseUrl,
        })

  return {
    kind: 'profile',
    provider,
    targetKey,
    profileId: profile.id,
    profile,
    label: profile.name,
    description: `${getBuiltinTargetLabel(provider)} profile · ${profile.model}`,
  }
}

function resolveBuiltinTargetOption(provider: APIProvider): ProviderSelectionTargetOption {
  return {
    kind: 'builtin',
    provider,
    targetKey: provider,
    label: getBuiltinTargetLabel(provider),
    description: getBuiltinTargetDescription(provider),
  }
}

export function getPersistedActiveProviderTarget(
  settings: SettingsJson | undefined = getSettings_DEPRECATED(),
): string | undefined {
  return trimString(settings?.activeProviderTarget)
}

export function getCurrentProviderSelectionTarget(): ProviderSelectionTarget {
  return resolveProviderSelectionTarget()
}

export function resolveProviderSelectionTargetOption(
  targetKey: string,
): ProviderSelectionTargetOption | undefined {
  const trimmed = trimString(targetKey)
  if (!trimmed) {
    return undefined
  }

  if (trimmed.startsWith('profile:')) {
    const profileId = trimmed.slice('profile:'.length)
    const profile = getProviderProfiles().find(item => item.id === profileId)
    return profile ? resolveProfileTargetOption(profile) : undefined
  }

  if (isBuiltinTargetKey(trimmed)) {
    return resolveBuiltinTargetOption(trimmed)
  }

  return undefined
}

export function getProviderSelectionTargetOptions(
  settings: SettingsJson | undefined = getSettings_DEPRECATED(),
): ProviderSelectionTargetOption[] {
  const current = getCurrentProviderSelectionTarget()
  const persistedTargetKey = getPersistedActiveProviderTarget(settings)
  const options: ProviderSelectionTargetOption[] = []
  const seen = new Set<string>()

  const push = (option: ProviderSelectionTargetOption | undefined): void => {
    if (!option || seen.has(option.targetKey)) {
      return
    }
    seen.add(option.targetKey)
    options.push(option)
  }

  push(resolveProviderSelectionTargetOption(current.targetKey))
  push(resolveProviderSelectionTargetOption(persistedTargetKey ?? ''))
  push(resolveBuiltinTargetOption('firstParty'))
  push(resolveBuiltinTargetOption('codex'))

  if (
    current.targetKey === current.provider &&
    current.provider !== 'firstParty' &&
    current.provider !== 'codex'
  ) {
    push(resolveBuiltinTargetOption(current.provider))
  }

  for (const profile of getProviderProfiles()) {
    push(resolveProfileTargetOption(profile))
  }

  return options
}

function getPersistedModelForTarget(
  target: ProviderSelectionTargetOption,
  settings: SettingsJson | undefined,
): string | undefined {
  const persisted = getPersistedModelSettingForProvider({
    settings,
    provider: target.provider,
    targetKey: target.targetKey,
  })

  if (!persisted) {
    return undefined
  }

  if (
    target.provider === 'codex' &&
    resolveSettingsModelProvider({
      provider: 'codex',
      model: persisted,
    }) !== 'codex'
  ) {
    return undefined
  }

  if (
    target.provider === 'openai' &&
    resolveSettingsModelProvider({
      provider: 'openai',
      model: persisted,
    }) === 'codex'
  ) {
    return undefined
  }

  return persisted
}

export function getDefaultModelSettingForTarget(
  target: ProviderSelectionTargetOption,
  settings: SettingsJson | undefined = getSettings_DEPRECATED(),
): string | null {
  const persisted = getPersistedModelForTarget(target, settings)
  if (persisted) {
    return persisted
  }

  if (target.kind === 'profile') {
    return target.profile?.model ?? null
  }

  return getFallbackModelForBuiltinTarget(target.provider) ?? null
}

function resolveAliasForFirstPartyTarget(modelSetting: string | null): string {
  const normalized = modelSetting?.trim().toLowerCase() ?? ''
  const has1mTag = normalized.endsWith('[1m]')
  const base = has1mTag
    ? normalized.replace(/\[1m\]$/i, '').trim()
    : normalized

  let resolved: string
  switch (base) {
    case '':
      resolved = getFirstPartyDefaultResolvedModel()
      break
    case 'sonnet':
      resolved = getModelStrings().sonnet46
      break
    case 'opus':
      resolved = getModelStrings().opus46
      break
    case 'haiku':
      resolved = getModelStrings().haiku45
      break
    case 'opusplan':
      resolved = getModelStrings().sonnet46
      break
    default:
      resolved = modelSetting ?? getFirstPartyDefaultResolvedModel()
      break
  }

  return has1mTag ? `${resolved}[1m]` : resolved
}

export function resolveModelSettingForTarget(
  target: ProviderSelectionTargetOption,
  modelSetting: string | null | undefined,
  settings: SettingsJson | undefined = getSettings_DEPRECATED(),
): string {
  const selectedModel = modelSetting ?? getDefaultModelSettingForTarget(target, settings)

  if (target.provider === 'firstParty') {
    return resolveAliasForFirstPartyTarget(selectedModel)
  }

  if (
    selectedModel === null ||
    selectedModel === undefined ||
    selectedModel.trim() === '' ||
    selectedModel === 'sonnet' ||
    selectedModel === 'opus' ||
    selectedModel === 'haiku'
  ) {
    return (
      getDefaultModelSettingForTarget(target, settings) ??
      getFallbackModelForBuiltinTarget(target.provider) ??
      getFirstPartyDefaultResolvedModel()
    )
  }

  return selectedModel
}

function clearGeminiEnv(): void {
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_AUTH_MODE
  delete process.env.GEMINI_ACCESS_TOKEN
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GOOGLE_API_KEY
}

function clearMistralEnv(): void {
  delete process.env.MISTRAL_API_KEY
  delete process.env.MISTRAL_MODEL
  delete process.env.MISTRAL_BASE_URL
}

function clearAnthropicSelectionEnv(): void {
  delete process.env.ANTHROPIC_MODEL
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_API_KEY
}

function setOpenAIProviderEnv(model: string): void {
  clearProviderProfileEnvFromProcessEnv()
  clearGeminiEnv()
  clearMistralEnv()
  clearAnthropicSelectionEnv()

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = model
  delete process.env.CLAUDE_CODE_USE_GITHUB
}

function setFirstPartyProviderEnv(model: string | undefined): void {
  clearProviderProfileEnvFromProcessEnv()
  clearGeminiEnv()
  clearMistralEnv()
  delete process.env.CLAUDE_CODE_USE_GITHUB

  if (model) {
    process.env.ANTHROPIC_MODEL = model
  } else {
    delete process.env.ANTHROPIC_MODEL
  }
}

function setGithubProviderEnv(model: string): void {
  clearProviderProfileEnvFromProcessEnv()
  clearGeminiEnv()
  clearMistralEnv()
  clearAnthropicSelectionEnv()

  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = model
  hydrateGithubModelsTokenFromSecureStorage()
}

function setGeminiProviderEnv(model: string): void {
  clearProviderProfileEnvFromProcessEnv()
  clearMistralEnv()
  clearAnthropicSelectionEnv()

  process.env.CLAUDE_CODE_USE_GEMINI = '1'
  process.env.GEMINI_MODEL = model
}

function setMistralProviderEnv(model: string): void {
  clearProviderProfileEnvFromProcessEnv()
  clearGeminiEnv()
  clearAnthropicSelectionEnv()

  process.env.CLAUDE_CODE_USE_MISTRAL = '1'
  process.env.MISTRAL_MODEL = model
}

export function applyProviderSelectionTarget(
  targetKey: string,
  settings: SettingsJson | undefined = getSettings_DEPRECATED(),
): ProviderSelectionTargetOption | undefined {
  const target = resolveProviderSelectionTargetOption(targetKey)
  if (!target) {
    return undefined
  }

  if (target.kind === 'profile' && target.profile) {
    const current = getGlobalConfig()
    if (current.activeProviderProfileId !== target.profile.id) {
      saveGlobalConfig(config => ({
        ...config,
        activeProviderProfileId: target.profile!.id,
      }))
    }
    applyProviderProfileToProcessEnv(target.profile)
    return target
  }

  const model = getPersistedModelForTarget(target, settings)
  const resolvedModel = resolveModelSettingForTarget(target, model, settings)

  switch (target.provider) {
    case 'firstParty':
      setFirstPartyProviderEnv(model ? resolvedModel : undefined)
      return target
    case 'codex':
      setOpenAIProviderEnv(resolvedModel)
      return target
    case 'openai':
      setOpenAIProviderEnv(resolvedModel)
      return target
    case 'github':
      setGithubProviderEnv(resolvedModel)
      return target
    case 'gemini':
      setGeminiProviderEnv(resolvedModel)
      return target
    case 'mistral':
      setMistralProviderEnv(resolvedModel)
      return target
    case 'bedrock':
    case 'vertex':
    case 'foundry':
      return target
  }
}

export function applyPersistedProviderSelectionTarget(
  settings: SettingsJson | undefined = getSettings_DEPRECATED(),
  options?: {
    force?: boolean
  },
): ProviderSelectionTargetOption | undefined {
  if (!options?.force && process.env.CLAUDE_CODE_PROVIDER_CLI_OVERRIDE === '1') {
    return undefined
  }

  if (
    !options?.force &&
    isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
  ) {
    return undefined
  }

  const targetKey = getPersistedActiveProviderTarget(settings)
  if (!targetKey) {
    return undefined
  }

  return applyProviderSelectionTarget(targetKey, settings)
}
