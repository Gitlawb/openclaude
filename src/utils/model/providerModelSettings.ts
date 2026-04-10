import { resolveProviderRequest } from '../../services/api/providerConfig.js'
import type { SettingsJson } from '../settings/types.js'
import { isModelAlias } from './aliases.js'
import { getAPIProvider, type APIProvider } from './providers.js'

export type ProviderModelSettings = Partial<Record<APIProvider, string>>

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

function getProviderModelSettings(
  settings: SettingsJson | undefined,
): ProviderModelSettings | undefined {
  const providerModels = settings?.providerModels
  if (!providerModels || typeof providerModels !== 'object') {
    return undefined
  }
  return providerModels as ProviderModelSettings
}

export function getPersistedModelSettingForProvider(options?: {
  settings?: SettingsJson
  provider?: APIProvider
  model?: string
  baseUrl?: string
}): string | undefined {
  const settings = options?.settings
  const provider = resolveSettingsModelProvider({
    provider: options?.provider,
    model: options?.model,
    baseUrl: options?.baseUrl,
  })

  const providerModel = asTrimmedModel(
    getProviderModelSettings(settings)?.[provider],
  )
  if (providerModel) {
    return providerModel
  }

  const legacyModel = asTrimmedModel(settings?.model)
  if (legacyModel && isLegacyModelCompatibleWithProvider(legacyModel, provider)) {
    return legacyModel
  }

  return undefined
}

export function buildProviderModelSettingsUpdate(options: {
  settings?: SettingsJson
  provider?: APIProvider
  model?: string | null
  baseUrl?: string
}): Pick<SettingsJson, 'model' | 'providerModels'> {
  const provider = resolveSettingsModelProvider({
    provider: options.provider,
    model: options.model ?? undefined,
    baseUrl: options.baseUrl,
  })
  const normalizedModel = asTrimmedModel(options.model)
  const legacyModel = asTrimmedModel(options.settings?.model)

  const update: Pick<SettingsJson, 'model' | 'providerModels'> = {
    providerModels: {
      [provider]: normalizedModel,
    } as SettingsJson['providerModels'],
  }

  if (normalizedModel) {
    update.model = normalizedModel
  } else if (
    legacyModel &&
    isLegacyModelCompatibleWithProvider(legacyModel, provider)
  ) {
    update.model = undefined
  }

  return update
}
