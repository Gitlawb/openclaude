import { randomBytes } from 'crypto'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type ProviderProfile,
} from './config.js'
import type { ModelOption } from './model/modelOptions.js'

export type ProviderPreset =
  | 'anthropic'
  | 'ollama'
  | 'openai'
  | 'moonshotai'
  | 'deepseek'
  | 'gemini'
  | 'together'
  | 'groq'
  | 'mistral'
  | 'azure-openai'
  | 'openrouter'
  | 'lmstudio'
  | 'custom'
  | 'nvidia-nim'
  | 'minimax'

export type ProviderProfileInput = {
  provider?: ProviderProfile['provider']
  name: string
  baseUrl: string
  model: string
  apiKey?: string
}

export type ProviderPresetDefaults = Omit<ProviderProfileInput, 'provider'> & {
  provider: ProviderProfile['provider']
  requiresApiKey: boolean
}

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b'
const PROFILE_ENV_APPLIED_FLAG = 'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED'

function trimValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = trimValue(value)
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeBaseUrl(value: string): string {
  return trimValue(value).replace(/\/+$/, '')
}

function sanitizeProfile(profile: ProviderProfile): ProviderProfile | null {
  const id = trimValue(profile.id)
  const name = trimValue(profile.name)
  const provider = profile.provider === 'anthropic' ? 'anthropic' : 'openai'
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const model = trimValue(profile.model)

  if (!id || !name || !baseUrl || !model) {
    return null
  }

  return {
    id,
    name,
    provider,
    baseUrl,
    model,
    apiKey: trimOrUndefined(profile.apiKey),
  }
}

function sanitizeProfiles(profiles: ProviderProfile[] | undefined): ProviderProfile[] {
  const seen = new Set<string>()
  const sanitized: ProviderProfile[] = []

  for (const profile of profiles ?? []) {
    const normalized = sanitizeProfile(profile)
    if (!normalized || seen.has(normalized.id)) {
      continue
    }
    seen.add(normalized.id)
    sanitized.push(normalized)
  }

  return sanitized
}

function nextProfileId(): string {
  return `provider_${randomBytes(6).toString('hex')}`
}

function toProfile(
  input: ProviderProfileInput,
  id: string = nextProfileId(),
): ProviderProfile | null {
  return sanitizeProfile({
    id,
    provider: input.provider ?? 'openai',
    name: input.name,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: input.apiKey,
  })
}

function getModelCacheByProfile(
  profileId: string,
  config = getGlobalConfig(),
): ModelOption[] {
  return config.openaiAdditionalModelOptionsCacheByProfile?.[profileId] ?? []
}

export function getProviderPresetDefaults(
  preset: ProviderPreset,
): ProviderPresetDefaults {
  switch (preset) {
    case 'anthropic':
      return {
        provider: 'anthropic',
        name: 'Anthropic',
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'openai':
      return {
        provider: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.3-codex',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'moonshotai':
      return {
        provider: 'openai',
        name: 'Moonshot AI',
        baseUrl: 'https://api.moonshot.ai/v1',
        model: 'kimi-k2.5',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'deepseek':
      return {
        provider: 'openai',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'gemini':
      return {
        provider: 'openai',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-3-flash-preview',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'together':
      return {
        provider: 'openai',
        name: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        model: 'Qwen/Qwen3.5-9B',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'groq':
      return {
        provider: 'openai',
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'mistral':
      return {
        provider: 'openai',
        name: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        model: 'mistral-large-latest',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'azure-openai':
      return {
        provider: 'openai',
        name: 'Azure OpenAI',
        baseUrl: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
        model: 'YOUR-DEPLOYMENT-NAME',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'openrouter':
      return {
        provider: 'openai',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5-mini',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'lmstudio':
      return {
        provider: 'openai',
        name: 'LM Studio',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        apiKey: '',
        requiresApiKey: false,
      }
    case 'custom':
      return {
        provider: 'openai',
        name: 'Custom OpenAI-compatible',
        baseUrl:
          process.env.OPENAI_BASE_URL ??
          process.env.OPENAI_API_BASE ??
          DEFAULT_OLLAMA_BASE_URL,
        model: process.env.OPENAI_MODEL ?? DEFAULT_OLLAMA_MODEL,
        apiKey: process.env.OPENAI_API_KEY ?? '',
        requiresApiKey: false,
      }
    case 'nvidia-nim':
      return {
        provider: 'openai',
        name: 'NVIDIA NIM',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/nemotron-mini-4b-instruct',
        apiKey: process.env.NVIDIA_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'minimax':
      return {
        provider: 'openai',
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        model: 'MiniMax-M2',
        apiKey: process.env.MINIMAX_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'ollama':
    default:
      return {
        provider: 'openai',
        name: 'Ollama',
        baseUrl: DEFAULT_OLLAMA_BASE_URL,
        model: process.env.OPENAI_MODEL ?? DEFAULT_OLLAMA_MODEL,
        apiKey: '',
        requiresApiKey: false,
      }
  }
}

export function getProviderProfiles(
  config = getGlobalConfig(),
): ProviderProfile[] {
  return sanitizeProfiles(config.providerProfiles)
}

export function hasProviderProfiles(config = getGlobalConfig()): boolean {
  return getProviderProfiles(config).length > 0
}

function hasProviderSelectionFlags(
  processEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    processEnv.CLAUDE_CODE_USE_OPENAI !== undefined ||
    processEnv.CLAUDE_CODE_USE_GEMINI !== undefined ||
    processEnv.CLAUDE_CODE_USE_GITHUB !== undefined ||
    processEnv.CLAUDE_CODE_USE_BEDROCK !== undefined ||
    processEnv.CLAUDE_CODE_USE_VERTEX !== undefined ||
    processEnv.CLAUDE_CODE_USE_FOUNDRY !== undefined
  )
}

function sameOptionalEnvValue(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return trimOrUndefined(left) === trimOrUndefined(right)
}

function isProcessEnvAlignedWithProfile(
  processEnv: NodeJS.ProcessEnv,
  profile: ProviderProfile,
  options?: {
    includeApiKey?: boolean
  },
): boolean {
  const includeApiKey = options?.includeApiKey ?? true

  if (processEnv[PROFILE_ENV_APPLIED_FLAG] !== '1') {
    return false
  }

  if (profile.provider === 'anthropic') {
    return (
      !hasProviderSelectionFlags(processEnv) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_BASE_URL, profile.baseUrl) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, profile.model) &&
      (!includeApiKey ||
        sameOptionalEnvValue(processEnv.ANTHROPIC_API_KEY, profile.apiKey))
    )
  }

  return (
    processEnv.CLAUDE_CODE_USE_OPENAI !== undefined &&
    processEnv.CLAUDE_CODE_USE_GEMINI === undefined &&
    processEnv.CLAUDE_CODE_USE_GITHUB === undefined &&
    processEnv.CLAUDE_CODE_USE_BEDROCK === undefined &&
    processEnv.CLAUDE_CODE_USE_VERTEX === undefined &&
    processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
    sameOptionalEnvValue(processEnv.OPENAI_BASE_URL, profile.baseUrl) &&
    sameOptionalEnvValue(processEnv.OPENAI_MODEL, profile.model) &&
    (!includeApiKey ||
      sameOptionalEnvValue(processEnv.OPENAI_API_KEY, profile.apiKey))
  )
}

export function getActiveProviderProfile(
  config = getGlobalConfig(),
): ProviderProfile | undefined {
  const profiles = getProviderProfiles(config)
  if (profiles.length === 0) {
    return undefined
  }

  const activeId = trimOrUndefined(config.activeProviderProfileId)
  return profiles.find(profile => profile.id === activeId) ?? profiles[0]
}

export function clearProviderProfileEnvFromProcessEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): void {
  delete processEnv.CLAUDE_CODE_USE_OPENAI
  delete processEnv.CLAUDE_CODE_USE_GEMINI
  delete processEnv.CLAUDE_CODE_USE_GITHUB
  delete processEnv.CLAUDE_CODE_USE_BEDROCK
  delete processEnv.CLAUDE_CODE_USE_VERTEX
  delete processEnv.CLAUDE_CODE_USE_FOUNDRY

  delete processEnv.OPENAI_BASE_URL
  delete processEnv.OPENAI_API_BASE
  delete processEnv.OPENAI_MODEL
  delete processEnv.OPENAI_API_KEY

  delete processEnv.ANTHROPIC_BASE_URL
  delete processEnv.ANTHROPIC_MODEL
  delete processEnv.ANTHROPIC_API_KEY
  delete processEnv[PROFILE_ENV_APPLIED_FLAG]
}

export function applyProviderProfileToProcessEnv(profile: ProviderProfile): void {
  clearProviderProfileEnvFromProcessEnv()
  process.env[PROFILE_ENV_APPLIED_FLAG] = '1'

  process.env.ANTHROPIC_MODEL = profile.model
  if (profile.provider === 'anthropic') {
    process.env.ANTHROPIC_BASE_URL = profile.baseUrl

    if (profile.apiKey) {
      process.env.ANTHROPIC_API_KEY = profile.apiKey
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }

    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_KEY
    return
  }

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = profile.baseUrl
  process.env.OPENAI_MODEL = profile.model

  if (profile.apiKey) {
    process.env.OPENAI_API_KEY = profile.apiKey
  } else {
    delete process.env.OPENAI_API_KEY
  }
}

export function applyActiveProviderProfileFromConfig(
  config = getGlobalConfig(),
  options?: {
    processEnv?: NodeJS.ProcessEnv
    force?: boolean
  },
): ProviderProfile | undefined {
  const processEnv = options?.processEnv ?? process.env
  const activeProfile = getActiveProviderProfile(config)
  if (!activeProfile) {
    return undefined
  }

  if (!options?.force && hasProviderSelectionFlags(processEnv)) {
    // Respect explicit startup provider intent. Re-apply only when the
    // current process env is already profile-managed and aligned.
    if (!isProcessEnvAlignedWithProfile(processEnv, activeProfile)) {
      return undefined
    }
  }

  applyProviderProfileToProcessEnv(activeProfile)
  return activeProfile
}

export function addProviderProfile(
  input: ProviderProfileInput,
  options?: { makeActive?: boolean },
): ProviderProfile | null {
  const profile = toProfile(input)
  if (!profile) {
    return null
  }

  const makeActive = options?.makeActive ?? true

  saveGlobalConfig(current => {
    const currentProfiles = getProviderProfiles(current)
    const nextProfiles = [...currentProfiles, profile]
    const currentActive = trimOrUndefined(current.activeProviderProfileId)
    const nextActiveId =
      makeActive || !currentActive || !nextProfiles.some(p => p.id === currentActive)
        ? profile.id
        : currentActive

    return {
      ...current,
      providerProfiles: nextProfiles,
      activeProviderProfileId: nextActiveId,
    }
  })

  const activeProfile = getActiveProviderProfile()
  if (activeProfile?.id === profile.id) {
    applyProviderProfileToProcessEnv(profile)
    clearActiveOpenAIModelOptionsCache()
  }

  return profile
}

export function updateProviderProfile(
  profileId: string,
  input: ProviderProfileInput,
): ProviderProfile | null {
  const updatedProfile = toProfile(input, profileId)
  if (!updatedProfile) {
    return null
  }

  let wasUpdated = false
  let shouldApply = false

  saveGlobalConfig(current => {
    const currentProfiles = getProviderProfiles(current)
    const profileIndex = currentProfiles.findIndex(
      profile => profile.id === profileId,
    )

    if (profileIndex < 0) {
      return current
    }

    wasUpdated = true

    const nextProfiles = [...currentProfiles]
    nextProfiles[profileIndex] = updatedProfile

    const cacheByProfile = {
      ...(current.openaiAdditionalModelOptionsCacheByProfile ?? {}),
    }
    delete cacheByProfile[profileId]

    const currentActive = trimOrUndefined(current.activeProviderProfileId)
    const nextActiveId =
      currentActive && nextProfiles.some(profile => profile.id === currentActive)
        ? currentActive
        : nextProfiles[0]?.id

    shouldApply = nextActiveId === profileId

    return {
      ...current,
      providerProfiles: nextProfiles,
      activeProviderProfileId: nextActiveId,
      openaiAdditionalModelOptionsCacheByProfile: cacheByProfile,
      openaiAdditionalModelOptionsCache: shouldApply
        ? []
        : current.openaiAdditionalModelOptionsCache,
    }
  })

  if (!wasUpdated) {
    return null
  }

  if (shouldApply) {
    applyProviderProfileToProcessEnv(updatedProfile)
  }

  return updatedProfile
}

export function setActiveProviderProfile(
  profileId: string,
): ProviderProfile | null {
  const current = getGlobalConfig()
  const profiles = getProviderProfiles(current)
  const activeProfile = profiles.find(profile => profile.id === profileId)

  if (!activeProfile) {
    return null
  }

  saveGlobalConfig(config => ({
    ...config,
    activeProviderProfileId: profileId,
    openaiAdditionalModelOptionsCache: getModelCacheByProfile(profileId, config),
  }))

  applyProviderProfileToProcessEnv(activeProfile)
  return activeProfile
}

export function deleteProviderProfile(profileId: string): {
  removed: boolean
  activeProfileId?: string
} {
  let removed = false
  let deletedProfile: ProviderProfile | undefined
  let nextActiveProfile: ProviderProfile | undefined

  saveGlobalConfig(current => {
    const currentProfiles = getProviderProfiles(current)
    const existing = currentProfiles.find(profile => profile.id === profileId)

    if (!existing) {
      return current
    }

    removed = true
    deletedProfile = existing

    const nextProfiles = currentProfiles.filter(profile => profile.id !== profileId)
    const currentActive = trimOrUndefined(current.activeProviderProfileId)
    const activeWasDeleted =
      !currentActive || currentActive === profileId ||
      !nextProfiles.some(profile => profile.id === currentActive)

    const nextActiveId = activeWasDeleted ? nextProfiles[0]?.id : currentActive

    if (nextActiveId) {
      nextActiveProfile =
        nextProfiles.find(profile => profile.id === nextActiveId) ?? nextProfiles[0]
    }

    const cacheByProfile = {
      ...(current.openaiAdditionalModelOptionsCacheByProfile ?? {}),
    }
    delete cacheByProfile[profileId]

    return {
      ...current,
      providerProfiles: nextProfiles,
      activeProviderProfileId: nextActiveId,
      openaiAdditionalModelOptionsCacheByProfile: cacheByProfile,
      openaiAdditionalModelOptionsCache: nextActiveId
        ? getModelCacheByProfile(nextActiveId, {
            ...current,
            openaiAdditionalModelOptionsCacheByProfile: cacheByProfile,
          })
        : [],
    }
  })

  if (nextActiveProfile) {
    applyProviderProfileToProcessEnv(nextActiveProfile)
  } else if (
    deletedProfile &&
    isProcessEnvAlignedWithProfile(process.env, deletedProfile, {
      includeApiKey: false,
    })
  ) {
    clearProviderProfileEnvFromProcessEnv()
  }

  return {
    removed,
    activeProfileId: nextActiveProfile?.id,
  }
}

export function getActiveOpenAIModelOptionsCache(
  config = getGlobalConfig(),
): ModelOption[] {
  const activeProfile = getActiveProviderProfile(config)

  if (!activeProfile) {
    return config.openaiAdditionalModelOptionsCache ?? []
  }

  const cached = config.openaiAdditionalModelOptionsCacheByProfile?.[
    activeProfile.id
  ]
  if (cached) {
    return cached
  }

  // Backward compatibility for users who have only the legacy single cache.
  if (
    Object.keys(config.openaiAdditionalModelOptionsCacheByProfile ?? {}).length ===
    0
  ) {
    return config.openaiAdditionalModelOptionsCache ?? []
  }

  return []
}

export function setActiveOpenAIModelOptionsCache(options: ModelOption[]): void {
  const activeProfile = getActiveProviderProfile()

  if (!activeProfile) {
    saveGlobalConfig(current => ({
      ...current,
      openaiAdditionalModelOptionsCache: options,
    }))
    return
  }

  saveGlobalConfig(current => ({
    ...current,
    openaiAdditionalModelOptionsCache: options,
    openaiAdditionalModelOptionsCacheByProfile: {
      ...(current.openaiAdditionalModelOptionsCacheByProfile ?? {}),
      [activeProfile.id]: options,
    },
  }))
}

export function clearActiveOpenAIModelOptionsCache(): void {
  const activeProfile = getActiveProviderProfile()

  if (!activeProfile) {
    saveGlobalConfig(current => ({
      ...current,
      openaiAdditionalModelOptionsCache: [],
    }))
    return
  }

  saveGlobalConfig(current => {
    const cacheByProfile = {
      ...(current.openaiAdditionalModelOptionsCacheByProfile ?? {}),
    }
    delete cacheByProfile[activeProfile.id]

    return {
      ...current,
      openaiAdditionalModelOptionsCache: [],
      openaiAdditionalModelOptionsCacheByProfile: cacheByProfile,
    }
  })
}
