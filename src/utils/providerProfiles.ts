import { randomBytes } from 'crypto'
import { isCodexBaseUrl } from '../services/api/providerConfig.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type ProviderProfile,
} from './config.js'
import type { ModelOption } from './model/modelOptions.js'
import { getPrimaryModel, parseModelList } from './providerModels.js'
import {
  buildCompatibilityProcessEnv,
  createProfileFile,
  saveProfileFile,
  buildBedrockProfileEnv,
  buildGeminiProfileEnv,
  buildGithubProfileEnv,
  buildMiniMaxProfileEnv,
  buildMistralProfileEnv,
  buildNvidiaNimProfileEnv,
  buildOpenAIProfileEnv,
  buildVertexProfileEnv,
  clearManagedProfileEnv,
  type ProfileEnv,
  type ProviderProfile as ProviderProfileStartup,
} from './providerProfile.js'
import {
  getProviderPresetUiMetadata,
  resolveProfileRoute,
  type ResolvedProfileRoute,
} from '../integrations/index.js'

export type ProviderPreset =
  | 'anthropic'
  | 'ollama'
  | 'openai'
  | 'kimi-code'
  | 'moonshotai'
  | 'deepseek'
  | 'gemini'
  | 'mistral'
  | 'together'
  | 'groq'
  | 'azure-openai'
  | 'openrouter'
  | 'lmstudio'
  | 'dashscope-cn'
  | 'dashscope-intl'
  | 'custom'
  | 'nvidia-nim'
  | 'minimax'
  | 'bankr'
  | 'atomic-chat'

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

const PROFILE_ENV_APPLIED_FLAG = 'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED'
const PROFILE_ENV_APPLIED_ID = 'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID'

type ProfileCompatibilityMode =
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'github'
  | 'bedrock'
  | 'vertex'
  | 'openai'

function resolveProfileCompatibility(provider: string): {
  route: ResolvedProfileRoute
  compatibilityMode: ProfileCompatibilityMode
} {
  const route = resolveProfileRoute(provider)

  if (route.gatewayId === 'github') {
    return { route, compatibilityMode: 'github' }
  }
  if (route.gatewayId === 'bedrock') {
    return { route, compatibilityMode: 'bedrock' }
  }
  if (route.gatewayId === 'vertex') {
    return { route, compatibilityMode: 'vertex' }
  }
  if (route.vendorId === 'anthropic') {
    return { route, compatibilityMode: 'anthropic' }
  }
  if (route.vendorId === 'gemini') {
    return { route, compatibilityMode: 'gemini' }
  }
  if (route.vendorId === 'mistral' || route.gatewayId === 'mistral') {
    return { route, compatibilityMode: 'mistral' }
  }

  return { route, compatibilityMode: 'openai' }
}

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
  const provider = trimValue(profile.provider)
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const model = trimValue(profile.model)

  if (!id || !name || !baseUrl || !model || !provider) {
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
  const metadata = getProviderPresetUiMetadata(preset)
  return {
    provider: metadata.provider,
    name: metadata.name,
    baseUrl: metadata.baseUrl,
    model: metadata.model,
    apiKey: metadata.apiKey,
    requiresApiKey: metadata.requiresApiKey,
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
    processEnv.CLAUDE_CODE_USE_MISTRAL !== undefined ||
    processEnv.CLAUDE_CODE_USE_GITHUB !== undefined ||
    processEnv.CLAUDE_CODE_USE_BEDROCK !== undefined ||
    processEnv.CLAUDE_CODE_USE_VERTEX !== undefined ||
    processEnv.CLAUDE_CODE_USE_FOUNDRY !== undefined
  )
}

/**
 * A "complete" explicit provider selection = a USE flag AND at least one
 * concrete config value that tells us WHERE to route (a base URL) or WHAT
 * to run (a model id). A bare `CLAUDE_CODE_USE_OPENAI=1` with nothing else
 * is almost always a stale shell export from a previous session, not real
 * intent — and if we respect it, we skip the user's saved active profile
 * and fall back to hardcoded defaults (gpt-4o / api.openai.com), which is
 * the exact bug users report as "my saved provider isn't picked up".
 *
 * Used to gate whether saved-profile env should override shell state at
 * startup. The weaker `hasProviderSelectionFlags` is still used for the
 * anthropic-profile conflict check (any flag is a conflict for
 * first-party anthropic) and for alignment fingerprinting.
 */
function hasCompleteProviderSelection(
  processEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!hasProviderSelectionFlags(processEnv)) return false
  if (processEnv.CLAUDE_CODE_USE_OPENAI !== undefined) {
    return (
      trimOrUndefined(processEnv.OPENAI_BASE_URL) !== undefined ||
      trimOrUndefined(processEnv.OPENAI_API_BASE) !== undefined ||
      trimOrUndefined(processEnv.OPENAI_MODEL) !== undefined
    )
  }
  if (processEnv.CLAUDE_CODE_USE_GEMINI !== undefined) {
    return (
      trimOrUndefined(processEnv.GEMINI_BASE_URL) !== undefined ||
      trimOrUndefined(processEnv.GEMINI_MODEL) !== undefined ||
      trimOrUndefined(processEnv.GEMINI_API_KEY) !== undefined ||
      trimOrUndefined(processEnv.GOOGLE_API_KEY) !== undefined
    )
  }
  if (processEnv.CLAUDE_CODE_USE_MISTRAL !== undefined) {
    return (
      trimOrUndefined(processEnv.MISTRAL_BASE_URL) !== undefined ||
      trimOrUndefined(processEnv.MISTRAL_MODEL) !== undefined ||
      trimOrUndefined(processEnv.MISTRAL_API_KEY) !== undefined
    )
  }
  if (processEnv.CLAUDE_CODE_USE_GITHUB !== undefined) {
    return (
      trimOrUndefined(processEnv.GITHUB_TOKEN) !== undefined ||
      trimOrUndefined(processEnv.GH_TOKEN) !== undefined ||
      trimOrUndefined(processEnv.OPENAI_MODEL) !== undefined
    )
  }
  // Bedrock / Vertex / Foundry signal cloud-provider routing in env; treat
  // the flag alone as complete (these paths rely on ambient AWS/GCP creds).
  return true
}

function hasConflictingProviderFlagsForProfile(
  processEnv: NodeJS.ProcessEnv,
  profile: ProviderProfile,
): boolean {
  const { compatibilityMode } = resolveProfileCompatibility(profile.provider)

  if (compatibilityMode === 'anthropic') {
    return hasProviderSelectionFlags(processEnv)
  }

  return (
    (compatibilityMode !== 'openai' && processEnv.CLAUDE_CODE_USE_OPENAI !== undefined) ||
    (compatibilityMode !== 'gemini' && processEnv.CLAUDE_CODE_USE_GEMINI !== undefined) ||
    (compatibilityMode !== 'mistral' && processEnv.CLAUDE_CODE_USE_MISTRAL !== undefined) ||
    (compatibilityMode !== 'github' && processEnv.CLAUDE_CODE_USE_GITHUB !== undefined) ||
    (compatibilityMode !== 'bedrock' && processEnv.CLAUDE_CODE_USE_BEDROCK !== undefined) ||
    (compatibilityMode !== 'vertex' && processEnv.CLAUDE_CODE_USE_VERTEX !== undefined) ||
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
  const { compatibilityMode } = resolveProfileCompatibility(profile.provider)

  if (processEnv[PROFILE_ENV_APPLIED_FLAG] !== '1') {
    return false
  }

  if (trimOrUndefined(processEnv[PROFILE_ENV_APPLIED_ID]) !== profile.id) {
    return false
  }

  if (compatibilityMode === 'anthropic') {
    return (
      !hasProviderSelectionFlags(processEnv) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_BASE_URL, profile.baseUrl) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, getPrimaryModel(profile.model)) &&
      (!includeApiKey ||
        sameOptionalEnvValue(processEnv.ANTHROPIC_API_KEY, profile.apiKey))
    )
  }

  if (compatibilityMode === 'mistral') {
    return (
      processEnv.CLAUDE_CODE_USE_MISTRAL !== undefined &&
      processEnv.CLAUDE_CODE_USE_GEMINI === undefined &&
      processEnv.CLAUDE_CODE_USE_OPENAI === undefined &&
      processEnv.CLAUDE_CODE_USE_GITHUB === undefined &&
      processEnv.CLAUDE_CODE_USE_BEDROCK === undefined &&
      processEnv.CLAUDE_CODE_USE_VERTEX === undefined &&
      processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
      sameOptionalEnvValue(processEnv.MISTRAL_BASE_URL, profile.baseUrl) &&
      sameOptionalEnvValue(processEnv.MISTRAL_MODEL, getPrimaryModel(profile.model)) &&
      (!includeApiKey ||
        sameOptionalEnvValue(processEnv.MISTRAL_API_KEY, profile.apiKey))
    )
  }

  if (compatibilityMode === 'gemini') {
    return (
      processEnv.CLAUDE_CODE_USE_GEMINI !== undefined &&
      processEnv.CLAUDE_CODE_USE_MISTRAL === undefined &&
      processEnv.CLAUDE_CODE_USE_OPENAI === undefined &&
      processEnv.CLAUDE_CODE_USE_GITHUB === undefined &&
      processEnv.CLAUDE_CODE_USE_BEDROCK === undefined &&
      processEnv.CLAUDE_CODE_USE_VERTEX === undefined &&
      processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
      sameOptionalEnvValue(processEnv.GEMINI_BASE_URL, profile.baseUrl) &&
      sameOptionalEnvValue(processEnv.GEMINI_MODEL, getPrimaryModel(profile.model)) &&
      (!includeApiKey ||
        sameOptionalEnvValue(processEnv.GEMINI_API_KEY, profile.apiKey))
    )
  }

  if (compatibilityMode === 'github') {
    return (
      processEnv.CLAUDE_CODE_USE_GITHUB !== undefined &&
      processEnv.CLAUDE_CODE_USE_OPENAI === undefined &&
      processEnv.CLAUDE_CODE_USE_GEMINI === undefined &&
      processEnv.CLAUDE_CODE_USE_MISTRAL === undefined &&
      processEnv.CLAUDE_CODE_USE_BEDROCK === undefined &&
      processEnv.CLAUDE_CODE_USE_VERTEX === undefined &&
      processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
      sameOptionalEnvValue(processEnv.OPENAI_BASE_URL, profile.baseUrl) &&
      sameOptionalEnvValue(processEnv.OPENAI_MODEL, getPrimaryModel(profile.model))
    )
  }

  if (compatibilityMode === 'bedrock') {
    return (
      processEnv.CLAUDE_CODE_USE_BEDROCK !== undefined &&
      processEnv.CLAUDE_CODE_USE_OPENAI === undefined &&
      processEnv.CLAUDE_CODE_USE_GEMINI === undefined &&
      processEnv.CLAUDE_CODE_USE_MISTRAL === undefined &&
      processEnv.CLAUDE_CODE_USE_GITHUB === undefined &&
      processEnv.CLAUDE_CODE_USE_VERTEX === undefined &&
      processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, getPrimaryModel(profile.model)) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_BEDROCK_BASE_URL, profile.baseUrl)
    )
  }

  if (compatibilityMode === 'vertex') {
    return (
      processEnv.CLAUDE_CODE_USE_VERTEX !== undefined &&
      processEnv.CLAUDE_CODE_USE_OPENAI === undefined &&
      processEnv.CLAUDE_CODE_USE_GEMINI === undefined &&
      processEnv.CLAUDE_CODE_USE_MISTRAL === undefined &&
      processEnv.CLAUDE_CODE_USE_GITHUB === undefined &&
      processEnv.CLAUDE_CODE_USE_BEDROCK === undefined &&
      processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, getPrimaryModel(profile.model)) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_VERTEX_BASE_URL, profile.baseUrl)
    )
  }

  return (
    processEnv.CLAUDE_CODE_USE_OPENAI !== undefined &&
    processEnv.CLAUDE_CODE_USE_GEMINI === undefined &&
    processEnv.CLAUDE_CODE_USE_MISTRAL === undefined &&
    processEnv.CLAUDE_CODE_USE_GITHUB === undefined &&
    processEnv.CLAUDE_CODE_USE_BEDROCK === undefined &&
    processEnv.CLAUDE_CODE_USE_VERTEX === undefined &&
    processEnv.CLAUDE_CODE_USE_FOUNDRY === undefined &&
    sameOptionalEnvValue(processEnv.OPENAI_BASE_URL, profile.baseUrl) &&
    sameOptionalEnvValue(processEnv.OPENAI_MODEL, getPrimaryModel(profile.model)) &&
    (!includeApiKey ||
      sameOptionalEnvValue(processEnv.OPENAI_API_KEY, profile.apiKey)) &&
    (profile.baseUrl?.toLowerCase().includes('bankr')
      ? !includeApiKey ||
        sameOptionalEnvValue(processEnv.BNKR_API_KEY, profile.apiKey)
      : true)
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
  clearManagedProfileEnv(processEnv)
  delete processEnv[PROFILE_ENV_APPLIED_FLAG]
  delete processEnv[PROFILE_ENV_APPLIED_ID]
}

export function applyProviderProfileToProcessEnv(profile: ProviderProfile): void {
  const { route, compatibilityMode } = resolveProfileCompatibility(profile.provider)
  const primaryModel = getPrimaryModel(profile.model)
  let profileEnv: ProfileEnv

  if (route.routeId === 'unknown-fallback') {
    // Safe fallback for unrecognised providers — OpenAI-compatible so the
    // user can still interact, but warn that the provider string was not
    // resolved to a known descriptor.
    console.warn(
      `[applyProviderProfileToProcessEnv] Unknown provider "${profile.provider}" — falling back to OpenAI-compatible env shaping.`,
    )
  }

  if (compatibilityMode === 'anthropic') {
    profileEnv = {
      ANTHROPIC_BASE_URL: profile.baseUrl,
      ANTHROPIC_MODEL: primaryModel,
      ...(profile.apiKey ? { ANTHROPIC_API_KEY: profile.apiKey } : {}),
    }
  } else if (compatibilityMode === 'mistral') {
    profileEnv = {
      MISTRAL_BASE_URL: profile.baseUrl,
      MISTRAL_MODEL: primaryModel,
      ...(profile.apiKey ? { MISTRAL_API_KEY: profile.apiKey } : {}),
    }
  } else if (compatibilityMode === 'gemini') {
    profileEnv = {
      GEMINI_BASE_URL: profile.baseUrl,
      GEMINI_MODEL: primaryModel,
      ...(profile.apiKey ? { GEMINI_API_KEY: profile.apiKey } : {}),
    }
  } else if (compatibilityMode === 'github') {
    profileEnv = buildGithubProfileEnv({
      model: primaryModel,
      baseUrl: profile.baseUrl,
    })
  } else if (compatibilityMode === 'bedrock') {
    profileEnv = buildBedrockProfileEnv({
      model: primaryModel,
      baseUrl: profile.baseUrl,
    })
  } else if (compatibilityMode === 'vertex') {
    profileEnv = buildVertexProfileEnv({
      model: primaryModel,
      baseUrl: profile.baseUrl,
    })
  } else {
    const openAIProfileEnv: ProfileEnv = {
      OPENAI_BASE_URL: profile.baseUrl,
      OPENAI_MODEL: primaryModel,
    }

    if (profile.apiKey) {
      openAIProfileEnv.OPENAI_API_KEY = profile.apiKey
      if (route.vendorId === 'minimax' || profile.baseUrl.toLowerCase().includes('minimax')) {
        openAIProfileEnv.MINIMAX_API_KEY = profile.apiKey
      }
      if (
        route.gatewayId === 'nvidia-nim' ||
        profile.baseUrl.toLowerCase().includes('nvidia') ||
        profile.baseUrl.toLowerCase().includes('integrate.api.nvidia')
      ) {
        openAIProfileEnv.NVIDIA_API_KEY = profile.apiKey
      }
      if (route.routeId === 'bankr' || profile.baseUrl.toLowerCase().includes('bankr')) {
        openAIProfileEnv.BNKR_API_KEY = profile.apiKey
      }
    }
    if (route.gatewayId === 'nvidia-nim') {
      openAIProfileEnv.NVIDIA_NIM = '1'
    }

    profileEnv = openAIProfileEnv
  }

  const nextEnv = buildCompatibilityProcessEnv({
    processEnv: process.env,
    compatibilityMode,
    profileEnv,
  })

  clearProviderProfileEnvFromProcessEnv()
  Object.assign(process.env, nextEnv)
  process.env[PROFILE_ENV_APPLIED_FLAG] = '1'
  process.env[PROFILE_ENV_APPLIED_ID] = profile.id
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

  const isCurrentEnvProfileManaged =
    processEnv[PROFILE_ENV_APPLIED_FLAG] === '1' &&
    trimOrUndefined(processEnv[PROFILE_ENV_APPLIED_ID]) === activeProfile.id

  if (!options?.force && (hasCompleteProviderSelection(processEnv) || processEnv[PROFILE_ENV_APPLIED_FLAG] === '1')) {
    // Respect explicit startup provider intent. Auto-heal only when this
    // exact active profile previously applied the current env.
    // NOTE: we gate on hasCompleteProviderSelection (flag + concrete config)
    // rather than hasProviderSelectionFlags alone. A bare CLAUDE_CODE_USE_*=1
    // with no BASE_URL/MODEL is almost always a stale shell export, not
    // intent — respecting it would skip the saved profile and fall through
    // to hardcoded provider defaults, which surfaces as "my saved provider
    // isn't being picked up at startup".
    if (!isCurrentEnvProfileManaged) {
      return undefined
    }

    if (hasConflictingProviderFlagsForProfile(processEnv, activeProfile)) {
      return undefined
    }

    if (isProcessEnvAlignedWithProfile(processEnv, activeProfile)) {
      return activeProfile
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
    setActiveProviderProfile(profile.id)
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

export function persistActiveProviderProfileModel(
  model: string,
): ProviderProfile | null {
  const nextModel = trimOrUndefined(model)
  if (!nextModel) {
    return null
  }

  const activeProfile = getActiveProviderProfile()
  if (!activeProfile) {
    return null
  }

  // If the model is already part of the profile's model list, don't
  // overwrite the field. This preserves comma-separated model lists like
  // "glm-4.5, glm-4.7". Switching between models in the list is a
  // session-level choice handled by mainLoopModelOverride, not a profile
  // edit — the profile's model list should only change via explicit edit.
  const existingModels = parseModelList(activeProfile.model)
  if (existingModels.includes(nextModel)) {
    return activeProfile
  }

  saveGlobalConfig(current => {
    const currentProfiles = getProviderProfiles(current)
    const profileIndex = currentProfiles.findIndex(
      profile => profile.id === activeProfile.id,
    )

    if (profileIndex < 0) {
      return current
    }

    const currentProfile = currentProfiles[profileIndex]
    if (currentProfile.model === nextModel) {
      return current
    }

    const nextProfiles = [...currentProfiles]
    nextProfiles[profileIndex] = {
      ...currentProfile,
      model: nextModel,
    }

    return {
      ...current,
      providerProfiles: nextProfiles,
    }
  })

  const resolvedProfile = getActiveProviderProfile()
  if (!resolvedProfile || resolvedProfile.id !== activeProfile.id) {
    return null
  }

  if (
    process.env[PROFILE_ENV_APPLIED_FLAG] === '1' &&
    trimOrUndefined(process.env[PROFILE_ENV_APPLIED_ID]) === resolvedProfile.id
  ) {
    applyProviderProfileToProcessEnv(resolvedProfile)
  }

  return resolvedProfile
}

/**
 * Generate model options from a provider profile's model field.
 * Each parsed model becomes a separate option in the picker.
 */
export function getProfileModelOptions(profile: ProviderProfile): ModelOption[] {
  const models = parseModelList(profile.model)
  if (models.length === 0) {
    return []
  }

  return models.map(model => ({
    value: model,
    label: model,
    description: `Provider: ${profile.name}`,
  }))
}

function buildOpenAICompatibleStartupEnv(
  activeProfile: ProviderProfile,
): ProfileEnv | null {
  if (isCodexBaseUrl(activeProfile.baseUrl)) {
    return null
  }

  if (activeProfile.apiKey) {
    const strictEnv = buildOpenAIProfileEnv({
      goal: 'balanced',
      model: activeProfile.model,
      baseUrl: activeProfile.baseUrl,
      apiKey: activeProfile.apiKey,
      processEnv: {},
    })
    if (strictEnv) {
      return strictEnv
    }
  }

  const env: ProfileEnv = {
    OPENAI_BASE_URL: activeProfile.baseUrl,
    OPENAI_MODEL: getPrimaryModel(activeProfile.model),
  }
  if (activeProfile.apiKey) {
    env.OPENAI_API_KEY = activeProfile.apiKey
    if (activeProfile.baseUrl?.toLowerCase().includes('bankr')) {
      env.BNKR_API_KEY = activeProfile.apiKey
    }
  } else {
    delete env.OPENAI_API_KEY
  }
  return env
}

function buildStartupProfileFromActiveProfile(
  activeProfile: ProviderProfile,
): {
  profile: ProviderProfileStartup
  env: ProfileEnv
} | null {
  const { route, compatibilityMode } = resolveProfileCompatibility(activeProfile.provider)

  switch (compatibilityMode) {
    case 'anthropic':
      return {
        profile: 'openai',
        env: {
          OPENAI_BASE_URL: activeProfile.baseUrl,
          OPENAI_MODEL: getPrimaryModel(activeProfile.model),
          OPENAI_API_KEY: activeProfile.apiKey,
        },
      }
    case 'gemini': {
      const env =
        buildGeminiProfileEnv({
          model: getPrimaryModel(activeProfile.model),
          baseUrl: activeProfile.baseUrl,
          apiKey: activeProfile.apiKey,
          authMode: 'api-key',
          processEnv: process.env,
        }) ?? null
      return env ? { profile: 'gemini', env } : null
    }
    case 'mistral': {
      const env =
        buildMistralProfileEnv({
          model: getPrimaryModel(activeProfile.model),
          baseUrl: activeProfile.baseUrl,
          apiKey: activeProfile.apiKey,
          processEnv: process.env,
        }) ?? null
      return env ? { profile: 'mistral', env } : null
    }
    case 'github':
      return {
        profile: 'github',
        env: buildGithubProfileEnv({
          model: getPrimaryModel(activeProfile.model),
          baseUrl: activeProfile.baseUrl,
        }),
      }
    case 'bedrock':
      return {
        profile: 'bedrock',
        env: buildBedrockProfileEnv({
          model: getPrimaryModel(activeProfile.model),
          baseUrl: activeProfile.baseUrl,
        }),
      }
    case 'vertex':
      return {
        profile: 'vertex',
        env: buildVertexProfileEnv({
          model: getPrimaryModel(activeProfile.model),
          baseUrl: activeProfile.baseUrl,
        }),
      }
    case 'openai': {
      if (route.gatewayId === 'nvidia-nim') {
        const env =
          buildNvidiaNimProfileEnv({
            model: getPrimaryModel(activeProfile.model),
            baseUrl: activeProfile.baseUrl,
            apiKey: activeProfile.apiKey,
            processEnv: process.env,
          }) ?? null
        return env ? { profile: 'nvidia-nim', env } : null
      }

      if (route.vendorId === 'minimax') {
        const env =
          buildMiniMaxProfileEnv({
            model: getPrimaryModel(activeProfile.model),
            baseUrl: activeProfile.baseUrl,
            apiKey: activeProfile.apiKey,
            processEnv: process.env,
          }) ?? null
        return env ? { profile: 'minimax', env } : null
      }

      const env = buildOpenAICompatibleStartupEnv(activeProfile)
      return env ? { profile: 'openai', env } : null
    }
  }
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

  const profileModelOptions = getProfileModelOptions(activeProfile)

  saveGlobalConfig(config => ({
    ...config,
    activeProviderProfileId: profileId,
    openaiAdditionalModelOptionsCache: profileModelOptions.length > 0
      ? profileModelOptions
      : getModelCacheByProfile(profileId, config),
    openaiAdditionalModelOptionsCacheByProfile: {
      ...(config.openaiAdditionalModelOptionsCacheByProfile ?? {}),
      [profileId]: profileModelOptions.length > 0
        ? profileModelOptions
        : (config.openaiAdditionalModelOptionsCacheByProfile?.[profileId] ?? []),
    },
  }))

  applyProviderProfileToProcessEnv(activeProfile)

  // Keep startup persisted provider profile in sync so initial startup
  // uses the selected provider/model.
  const startupProfile = buildStartupProfileFromActiveProfile(activeProfile)

  if (startupProfile) {
    const file = createProfileFile(startupProfile.profile, startupProfile.env)
    saveProfileFile(file)
  }

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
