import { resolveProviderRequest } from '../../services/api/providerConfig.js'
import type { EffortLevel, OpenAIEffortLevel } from '../effort.js'
import type { SettingsJson } from '../settings/types.js'
import { isModelAlias } from './aliases.js'
import { getAPIProvider, type APIProvider } from './providers.js'
import { getActiveProviderProfileSelectionTargetKey } from '../providerProfiles.js'

export type ProviderModelSettings = Partial<Record<APIProvider, string>>
export type PersistedEffortLevel = EffortLevel | OpenAIEffortLevel
export type PersistedServiceTier = 'fast'

export type ProviderTargetSelection = {
  model?: string
  effortLevel?: PersistedEffortLevel
  serviceTier?: PersistedServiceTier
}

export type ProviderTargetSelections = Record<
  string,
  ProviderTargetSelection | undefined
>

export type ProviderSelectionTarget = {
  provider: APIProvider
  targetKey: string
}

function asTrimmedModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function isAliasLikeModel(model: string): boolean {
  const normalized = model.toLowerCase().replace(/\[1m\]$/i, '').trim()
  return isModelAlias(normalized)
}

function isLegacyModelCompatibleWithProvider(
  model: string,
  provider: APIProvider,
): boolean {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return false

  const base = (normalized.split('?', 1)[0] ?? normalized).trim()
  if (isAliasLikeModel(base)) {
    return true
  }

  switch (provider) {
    case 'firstParty':
    case 'bedrock':
    case 'vertex':
    case 'foundry':
      return (
        base.startsWith('claude') ||
        base.includes('.claude-') ||
        base.startsWith('arn:aws:bedrock') ||
        base.startsWith('anthropic.claude') ||
        base.startsWith('us.anthropic.claude') ||
        base.startsWith('eu.anthropic.claude')
      )
    case 'gemini':
      return base.startsWith('gemini')
    case 'github':
      return base.startsWith('github:') || base === 'copilot'
    case 'codex':
      return (
        base === 'codexplan' ||
        base === 'codexspark' ||
        base.startsWith('gpt-5')
      )
    case 'openai':
      return !(
        base.startsWith('claude') ||
        base.startsWith('gemini') ||
        base.startsWith('github:') ||
        base.startsWith('arn:aws:bedrock') ||
        base.includes('.claude-')
      )
  }
}

function getProviderModelSettings(
  settings: SettingsJson | undefined,
): ProviderModelSettings | undefined {
  const providerModels = settings?.providerModels
  if (!providerModels || typeof providerModels !== 'object') {
    return undefined
  }
  return providerModels as ProviderModelSettings
}

function getProviderTargetSelections(
  settings: SettingsJson | undefined,
): ProviderTargetSelections | undefined {
  const providerTargetSelections = settings?.providerTargetSelections
  if (
    !providerTargetSelections ||
    typeof providerTargetSelections !== 'object'
  ) {
    return undefined
  }
  return providerTargetSelections as ProviderTargetSelections
}

function getPersistedEffortLevel(
  value: unknown,
): PersistedEffortLevel | undefined {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  if (value === 'xhigh') {
    return value
  }
  if (value === 'max' && process.env.USER_TYPE === 'ant') {
    return value
  }
  return undefined
}

function getPersistedServiceTier(
  value: unknown,
): PersistedServiceTier | undefined {
  return value === 'fast' ? value : undefined
}

export function resolveSettingsModelProvider(options?: {
  provider?: APIProvider
  model?: string
  baseUrl?: string
}): APIProvider {
  const provider = options?.provider ?? getAPIProvider()
  if (options?.provider !== undefined) {
    return provider
  }

  if (provider !== 'openai' && provider !== 'codex') {
    return provider
  }

  const request = resolveProviderRequest({
    model: options?.model,
    baseUrl: options?.baseUrl,
  })
  return request.transport === 'codex_responses' ? 'codex' : 'openai'
}

export function resolveProviderSelectionTarget(options?: {
  provider?: APIProvider
  model?: string
  baseUrl?: string
  targetKey?: string
  profileId?: string
}): ProviderSelectionTarget {
  const provider = resolveSettingsModelProvider({
    provider: options?.provider,
    model: options?.model,
    baseUrl: options?.baseUrl,
  })

  const explicitTargetKey = asTrimmedModel(options?.targetKey)
  if (explicitTargetKey) {
    return {
      provider,
      targetKey: explicitTargetKey,
    }
  }

  const explicitProfileKey = asTrimmedModel(options?.profileId)
  if (explicitProfileKey) {
    return {
      provider,
      targetKey: `profile:${explicitProfileKey}`,
    }
  }

  const activeProfileTargetKey = getActiveProviderProfileSelectionTargetKey()
  return {
    provider,
    targetKey: activeProfileTargetKey ?? provider,
  }
}

function getProviderTargetSelection(
  settings: SettingsJson | undefined,
  targetKey: string,
): ProviderTargetSelection | undefined {
  const selection = getProviderTargetSelections(settings)?.[targetKey]
  if (!selection || typeof selection !== 'object') {
    return undefined
  }
  return selection
}

function buildProviderTargetSelectionPatch(options: {
  settings?: SettingsJson
  targetKey: string
  model?: string | null
  effortLevel?: PersistedEffortLevel | null
  serviceTier?: PersistedServiceTier | null
}): ProviderTargetSelection | undefined {
  const current = getProviderTargetSelection(options.settings, options.targetKey)
  const next: ProviderTargetSelection = current ? { ...current } : {}
  let touched = false

  if (Object.prototype.hasOwnProperty.call(options, 'model')) {
    touched = true
    const model = asTrimmedModel(options.model)
    if (model) {
      next.model = model
    } else {
      delete next.model
    }
  }

  if (Object.prototype.hasOwnProperty.call(options, 'effortLevel')) {
    touched = true
    const effortLevel = getPersistedEffortLevel(options.effortLevel)
    if (effortLevel) {
      next.effortLevel = effortLevel
    } else {
      delete next.effortLevel
    }
  }

  if (Object.prototype.hasOwnProperty.call(options, 'serviceTier')) {
    touched = true
    const serviceTier = getPersistedServiceTier(options.serviceTier)
    if (serviceTier) {
      next.serviceTier = serviceTier
    } else {
      delete next.serviceTier
    }
  }

  if (!touched) {
    return undefined
  }

  return Object.keys(next).length > 0 ? next : undefined
}

export function getPersistedModelSettingForProvider(options?: {
  settings?: SettingsJson
  provider?: APIProvider
  model?: string
  baseUrl?: string
  targetKey?: string
  profileId?: string
}): string | undefined {
  const settings = options?.settings
  const target = resolveProviderSelectionTarget({
    provider: options?.provider,
    model: options?.model,
    baseUrl: options?.baseUrl,
    targetKey: options?.targetKey,
    profileId: options?.profileId,
  })

  const providerTargetModel = asTrimmedModel(
    getProviderTargetSelection(settings, target.targetKey)?.model,
  )
  if (providerTargetModel) {
    return providerTargetModel
  }

  const providerModel = asTrimmedModel(getProviderModelSettings(settings)?.[target.provider])
  if (providerModel) {
    return providerModel
  }

  const legacyModel = asTrimmedModel(settings?.model)
  if (legacyModel && isLegacyModelCompatibleWithProvider(legacyModel, target.provider)) {
    return legacyModel
  }

  return undefined
}

export function getPersistedEffortSettingForProvider(options?: {
  settings?: SettingsJson
  provider?: APIProvider
  model?: string
  baseUrl?: string
  targetKey?: string
  profileId?: string
}): PersistedEffortLevel | undefined {
  const settings = options?.settings
  const target = resolveProviderSelectionTarget({
    provider: options?.provider,
    model: options?.model,
    baseUrl: options?.baseUrl,
    targetKey: options?.targetKey,
    profileId: options?.profileId,
  })

  const providerTargetEffort = getPersistedEffortLevel(
    getProviderTargetSelection(settings, target.targetKey)?.effortLevel,
  )
  if (providerTargetEffort) {
    return providerTargetEffort
  }

  return getPersistedEffortLevel(settings?.effortLevel)
}

export function getPersistedServiceTierForProvider(options?: {
  settings?: SettingsJson
  provider?: APIProvider
  model?: string
  baseUrl?: string
  targetKey?: string
  profileId?: string
}): PersistedServiceTier | undefined {
  const settings = options?.settings
  const target = resolveProviderSelectionTarget({
    provider: options?.provider,
    model: options?.model,
    baseUrl: options?.baseUrl,
    targetKey: options?.targetKey,
    profileId: options?.profileId,
  })

  return getPersistedServiceTier(
    getProviderTargetSelection(settings, target.targetKey)?.serviceTier,
  )
}

export function buildProviderModelSettingsUpdate(options: {
  settings?: SettingsJson
  provider?: APIProvider
  model?: string | null
  effortLevel?: PersistedEffortLevel | null
  serviceTier?: PersistedServiceTier | null
  baseUrl?: string
  targetKey?: string
  profileId?: string
}): Partial<SettingsJson> {
  const target = resolveProviderSelectionTarget({
    provider: options.provider,
    model: options.model ?? undefined,
    baseUrl: options.baseUrl,
    targetKey: options.targetKey,
    profileId: options.profileId,
  })
  const normalizedModel = asTrimmedModel(options.model)
  const normalizedEffort = getPersistedEffortLevel(options.effortLevel)
  const legacyModel = asTrimmedModel(options.settings?.model)
  const nextTargetSelection = buildProviderTargetSelectionPatch({
    settings: options.settings,
    targetKey: target.targetKey,
    ...(Object.prototype.hasOwnProperty.call(options, 'model')
      ? { model: options.model }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'effortLevel')
      ? { effortLevel: options.effortLevel }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'serviceTier')
      ? { serviceTier: options.serviceTier }
      : {}),
  })

  const update: Partial<SettingsJson> = {}

  if (Object.prototype.hasOwnProperty.call(options, 'model')) {
    update.providerModels = {
      [target.provider]: normalizedModel,
    } as SettingsJson['providerModels']

    if (normalizedModel) {
      update.model = normalizedModel
    } else if (
      legacyModel &&
      isLegacyModelCompatibleWithProvider(legacyModel, target.provider)
    ) {
      update.model = undefined
    }
  }

  if (Object.prototype.hasOwnProperty.call(options, 'effortLevel')) {
    update.effortLevel = normalizedEffort
  }

  if (nextTargetSelection !== undefined) {
    update.providerTargetSelections = {
      [target.targetKey]: nextTargetSelection,
    } as SettingsJson['providerTargetSelections']
  } else if (
    Object.prototype.hasOwnProperty.call(options, 'model') ||
    Object.prototype.hasOwnProperty.call(options, 'effortLevel') ||
    Object.prototype.hasOwnProperty.call(options, 'serviceTier')
  ) {
    update.providerTargetSelections = {
      [target.targetKey]: undefined,
    } as unknown as SettingsJson['providerTargetSelections']
  }

  return update
}
