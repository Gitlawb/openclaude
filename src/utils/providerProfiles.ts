import { randomBytes } from 'crypto'
import {
  isCodexBaseUrl,
  parseOpenAICompatibleApiFormat,
} from '../services/api/providerConfig.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type ProviderProfile,
} from './config.js'
import type { ModelOption } from './model/modelOptions.js'
import { getPrimaryModel, parseModelList } from './providerModels.js'
import {
  createProfileFile,
  saveProfileFile,
  buildGeminiProfileEnv,
  buildMistralProfileEnv,
  buildOpenAIProfileEnv,
  type ProfileEnv,
  type ProviderProfile as ProviderProfileStartup,
} from './providerProfile.js'

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
  | 'xai'
  | 'zai'
  | 'bankr'
  | 'atomic-chat'

export type ProviderProfileInput = {
  provider?: ProviderProfile['provider']
  name: string
  baseUrl: string
  model: string
  apiKey?: string
  apiFormat?: ProviderProfile['apiFormat']
  authHeader?: ProviderProfile['authHeader']
  authScheme?: ProviderProfile['authScheme']
  authHeaderValue?: ProviderProfile['authHeaderValue']
}

export type ProviderPresetDefaults = Omit<ProviderProfileInput, 'provider'> & {
  provider: ProviderProfile['provider']
  requiresApiKey: boolean
}

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b'
const PROFILE_ENV_APPLIED_FLAG = 'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED'
const PROFILE_ENV_APPLIED_ID = 'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID'

function trimValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = trimValue(value)
  return trimmed.length > 0 ? trimmed : undefined
}

function sanitizeAuthHeader(value: string | undefined): string | undefined {
  const trimmed = trimOrUndefined(value)
  if (!trimmed) {
    return undefined
  }
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(trimmed)
    ? trimmed
    : undefined
}

function sanitizeAuthScheme(value: string | undefined): ProviderProfile['authScheme'] | undefined {
  return value === 'raw' || value === 'bearer' ? value : undefined
}

function normalizeBaseUrl(value: string): string {
  return trimValue(value).replace(/\/+$/, '')
}

function sanitizeProfile(profile: ProviderProfile): ProviderProfile | null {
  const id = trimValue(profile.id)
  const name = trimValue(profile.name)
  const provider =
    profile.provider === 'anthropic'
      ? 'anthropic'
      : profile.provider === 'mistral'
        ? 'mistral'
        : profile.provider === 'gemini'
          ? 'gemini'
          : 'openai'
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const model = trimValue(profile.model)
  const apiFormat = parseOpenAICompatibleApiFormat(profile.apiFormat)
  const authHeader = sanitizeAuthHeader(profile.authHeader)
  const authScheme = sanitizeAuthScheme(profile.authScheme)
  const authHeaderValue = trimOrUndefined(profile.authHeaderValue)

  if (!id || !name || !baseUrl || !model) {
    return null
  }

  const sanitized: ProviderProfile = {
    id,
    name,
    provider,
    baseUrl,
    model,
    apiKey: trimOrUndefined(profile.apiKey),
  }
  if (provider === 'openai' && apiFormat) {
    sanitized.apiFormat = apiFormat
  }
  if (provider === 'openai' && authHeader) {
    sanitized.authHeader = authHeader
    sanitized.authScheme = authScheme ?? (
      authHeader.toLowerCase() === 'authorization' ? 'bearer' : 'raw'
    )
    sanitized.authHeaderValue = authHeaderValue
  }
  return sanitized
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
    apiFormat: input.apiFormat,
    authHeader: input.authHeader,
    authScheme: input.authScheme,
    authHeaderValue: input.authHeaderValue,
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
        model: 'gpt-5.4',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'kimi-code':
      return {
        provider: 'openai',
        name: 'Moonshot AI - Kimi Code',
        baseUrl: 'https://api.kimi.com/coding/v1',
        model: 'kimi-for-coding',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'moonshotai':
      return {
        provider: 'openai',
        name: 'Moonshot AI - API',
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
        model: 'deepseek-v4-flash, deepseek-v4-pro, deepseek-chat, deepseek-reasoner',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'gemini':
      return {
        provider: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-3-flash-preview',
        apiKey: '',
        requiresApiKey: true,
      }
    case 'mistral':
      return {
        provider: 'mistral',
        name: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        model: 'devstral-latest',
        apiKey: '',
        requiresApiKey: true
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
    case 'dashscope-cn':
      return {
        provider: 'openai',
        name: 'Alibaba Coding Plan (China)',
        baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
        model: 'qwen3.6-plus',
        apiKey: process.env.DASHSCOPE_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'dashscope-intl':
      return {
        provider: 'openai',
        name: 'Alibaba Coding Plan',
        baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
        model: 'qwen3.6-plus',
        apiKey: process.env.DASHSCOPE_API_KEY ?? '',
        requiresApiKey: true,
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
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
        apiKey: process.env.NVIDIA_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'xai':
      return {
        provider: 'openai',
        name: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4',
        apiKey: process.env.XAI_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'minimax':
      return {
        provider: 'openai',
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        model: 'MiniMax-M2.5',
        apiKey: process.env.MINIMAX_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'atomic-chat':
      return {
        provider: 'openai',
        name: 'Atomic Chat',
        baseUrl: 'http://127.0.0.1:1337/v1',
        model: process.env.OPENAI_MODEL ?? 'local-model',
        apiKey: '',
        requiresApiKey: false,
      }
    case 'bankr':
      return {
        provider: 'openai',
        name: 'Bankr',
        baseUrl: 'https://llm.bankr.bot/v1',
        model: process.env.BANKR_MODEL ?? 'claude-opus-4.6',
        apiKey: process.env.BNKR_API_KEY ?? '',
        requiresApiKey: true,
      }
    case 'zai':
      return {
        provider: 'openai',
        name: 'Z.AI - GLM Coding Plan',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        model: 'GLM-5.1, GLM-5-Turbo, GLM-4.7, GLM-4.5-Air',
        apiKey: '',
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
  if (profile.provider === 'anthropic') {
    return hasProviderSelectionFlags(processEnv)
  }

  return (
    processEnv.CLAUDE_CODE_USE_GEMINI !== undefined ||
    processEnv.CLAUDE_CODE_USE_MISTRAL !== undefined ||
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

  if (trimOrUndefined(processEnv[PROFILE_ENV_APPLIED_ID]) !== profile.id) {
    return false
  }

  if (profile.provider === 'anthropic') {
    return (
      !hasProviderSelectionFlags(processEnv) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_BASE_URL, profile.baseUrl) &&
      sameOptionalEnvValue(processEnv.ANTHROPIC_MODEL, getPrimaryModel(profile.model)) &&
      (!includeApiKey ||
        sameOptionalEnvValue(processEnv.ANTHROPIC_API_KEY, profile.apiKey))
    )
  }

  if (profile.provider === 'mistral') {
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

  if (profile.provider === 'gemini') {
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
    sameOptionalEnvValue(processEnv.OPENAI_API_FORMAT, profile.apiFormat) &&
    sameOptionalEnvValue(processEnv.OPENAI_AUTH_HEADER, profile.authHeader) &&
    sameOptionalEnvValue(processEnv.OPENAI_AUTH_SCHEME, profile.authScheme) &&
    sameOptionalEnvValue(processEnv.OPENAI_AUTH_HEADER_VALUE, profile.authHeaderValue) &&
    (!includeApiKey ||
      sameOptionalEnvValue(processEnv.OPENAI_API_KEY, profile.apiKey)) &&
    (profile.baseUrl?.toLowerCase().includes('bankr')
      ? !includeApiKey ||
        sameOptionalEnvValue(processEnv.BNKR_API_KEY, profile.apiKey)
      : true) &&
    (profile.baseUrl?.toLowerCase().includes('x.ai')
      ? !includeApiKey ||
        sameOptionalEnvValue(processEnv.XAI_API_KEY, profile.apiKey)
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
  delete processEnv.CLAUDE_CODE_USE_OPENAI
  delete processEnv.CLAUDE_CODE_USE_GEMINI
  delete processEnv.CLAUDE_CODE_USE_MISTRAL
  delete processEnv.CLAUDE_CODE_USE_GITHUB
  delete processEnv.CLAUDE_CODE_USE_BEDROCK
  delete processEnv.CLAUDE_CODE_USE_VERTEX
  delete processEnv.CLAUDE_CODE_USE_FOUNDRY

  delete processEnv.OPENAI_BASE_URL
  delete processEnv.OPENAI_API_BASE
  delete processEnv.OPENAI_MODEL
  delete processEnv.OPENAI_API_FORMAT
  delete processEnv.OPENAI_AUTH_HEADER
  delete processEnv.OPENAI_AUTH_SCHEME
  delete processEnv.OPENAI_AUTH_HEADER_VALUE
  delete processEnv.OPENAI_API_KEY

  delete processEnv.ANTHROPIC_BASE_URL
  delete processEnv.ANTHROPIC_MODEL
  delete processEnv.ANTHROPIC_API_KEY
  delete processEnv[PROFILE_ENV_APPLIED_FLAG]
  delete processEnv[PROFILE_ENV_APPLIED_ID]

  delete processEnv.GEMINI_MODEL
  delete processEnv.GEMINI_BASE_URL
  delete processEnv.GEMINI_API_KEY
  delete processEnv.GEMINI_AUTH_MODE
  delete processEnv.GEMINI_ACCESS_TOKEN
  delete processEnv.GOOGLE_API_KEY

  delete processEnv.MISTRAL_MODEL
  delete processEnv.MISTRAL_BASE_URL
  delete processEnv.MISTRAL_API_KEY

  // Clear provider-specific API keys
  delete processEnv.MINIMAX_API_KEY
  delete processEnv.NVIDIA_API_KEY
  delete processEnv.NVIDIA_NIM
  delete processEnv.BANKR_BASE_URL
  delete processEnv.BNKR_API_KEY
  delete processEnv.BANKR_MODEL
  delete processEnv.XAI_API_KEY
}

export function applyProviderProfileToProcessEnv(profile: ProviderProfile): void {
  clearProviderProfileEnvFromProcessEnv()
  process.env[PROFILE_ENV_APPLIED_FLAG] = '1'
  process.env[PROFILE_ENV_APPLIED_ID] = profile.id

  process.env.ANTHROPIC_MODEL = getPrimaryModel(profile.model)
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
    delete process.env.OPENAI_API_FORMAT
    delete process.env.OPENAI_AUTH_HEADER
    delete process.env.OPENAI_AUTH_SCHEME
    delete process.env.OPENAI_AUTH_HEADER_VALUE
    delete process.env.OPENAI_API_KEY
    return
  }

  if (profile.provider === 'mistral') {
    process.env.CLAUDE_CODE_USE_MISTRAL = '1'
    process.env.MISTRAL_BASE_URL = profile.baseUrl
    process.env.MISTRAL_MODEL = getPrimaryModel(profile.model)

    if (profile.apiKey) {
      process.env.MISTRAL_API_KEY = profile.apiKey
    } else {
      delete process.env.MISTRAL_API_KEY
    }

    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_FORMAT
    delete process.env.OPENAI_AUTH_HEADER
    delete process.env.OPENAI_AUTH_SCHEME
    delete process.env.OPENAI_AUTH_HEADER_VALUE
    return
  }

  if (profile.provider === 'gemini') {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.GEMINI_BASE_URL = profile.baseUrl
    process.env.GEMINI_MODEL = getPrimaryModel(profile.model)

    if (profile.apiKey) {
      process.env.GEMINI_API_KEY = profile.apiKey
    } else {
      delete process.env.GEMINI_API_KEY
    }

    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_FORMAT
    delete process.env.OPENAI_AUTH_HEADER
    delete process.env.OPENAI_AUTH_SCHEME
    delete process.env.OPENAI_AUTH_HEADER_VALUE
    return
  }

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = profile.baseUrl
  process.env.OPENAI_MODEL = getPrimaryModel(profile.model)
  if (profile.apiFormat) {
    process.env.OPENAI_API_FORMAT = profile.apiFormat
  } else {
    delete process.env.OPENAI_API_FORMAT
  }
  if (profile.authHeader) {
    process.env.OPENAI_AUTH_HEADER = profile.authHeader
    process.env.OPENAI_AUTH_SCHEME = profile.authScheme ?? (
      profile.authHeader.toLowerCase() === 'authorization' ? 'bearer' : 'raw'
    )
    if (profile.authHeaderValue) {
      process.env.OPENAI_AUTH_HEADER_VALUE = profile.authHeaderValue
    } else {
      delete process.env.OPENAI_AUTH_HEADER_VALUE
    }
  } else {
    delete process.env.OPENAI_AUTH_HEADER
    delete process.env.OPENAI_AUTH_SCHEME
    delete process.env.OPENAI_AUTH_HEADER_VALUE
  }

  if (profile.apiKey) {
    process.env.OPENAI_API_KEY = profile.apiKey
    // Also set provider-specific API keys for detection
    const baseUrl = profile.baseUrl.toLowerCase()
    if (baseUrl.includes('minimax')) {
      process.env.MINIMAX_API_KEY = profile.apiKey
    }
    if (baseUrl.includes('nvidia') || baseUrl.includes('integrate.api.nvidia')) {
      process.env.NVIDIA_API_KEY = profile.apiKey
    }
    if (baseUrl.includes('bankr')) {
      process.env.BNKR_API_KEY = profile.apiKey
    }
    if (baseUrl.includes('x.ai')) {
      process.env.XAI_API_KEY = profile.apiKey
    }
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
      apiFormat: activeProfile.apiFormat,
      authHeader: activeProfile.authHeader,
      authScheme: activeProfile.authScheme,
      authHeaderValue: activeProfile.authHeaderValue,
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
  if (activeProfile.apiFormat) {
    env.OPENAI_API_FORMAT = activeProfile.apiFormat
  }
  if (activeProfile.authHeader) {
    env.OPENAI_AUTH_HEADER = activeProfile.authHeader
    env.OPENAI_AUTH_SCHEME = activeProfile.authScheme ?? (
      activeProfile.authHeader.toLowerCase() === 'authorization' ? 'bearer' : 'raw'
    )
    if (activeProfile.authHeaderValue) {
      env.OPENAI_AUTH_HEADER_VALUE = activeProfile.authHeaderValue
    }
  }
  if (activeProfile.apiKey) {
    env.OPENAI_API_KEY = activeProfile.apiKey
    if (activeProfile.baseUrl?.toLowerCase().includes('bankr')) {
      env.BNKR_API_KEY = activeProfile.apiKey
    }
    if (activeProfile.baseUrl?.toLowerCase().includes('x.ai')) {
      env.XAI_API_KEY = activeProfile.apiKey
    }
  } else {
    delete env.OPENAI_API_KEY
  }
  return env
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
  const persistedProfile = (() => {
    if (activeProfile.provider === 'anthropic') return 'openai' as const
    return activeProfile.provider
  })()

  const profileEnv = (() => {
    switch (activeProfile.provider) {
      case 'gemini':
        return (
          buildGeminiProfileEnv({
            model: getPrimaryModel(activeProfile.model),
            baseUrl: activeProfile.baseUrl,
            apiKey: activeProfile.apiKey,
            authMode: 'api-key',
            processEnv: process.env,
          }) ?? null
        )
      case 'mistral':
        return (
          buildMistralProfileEnv({
            model: getPrimaryModel(activeProfile.model),
            baseUrl: activeProfile.baseUrl,
            apiKey: activeProfile.apiKey,
            processEnv: process.env,
          }) ?? null
        )
      default:
        return activeProfile.provider === 'anthropic'
          ? (
              buildOpenAIProfileEnv({
                goal: 'balanced',
                model: getPrimaryModel(activeProfile.model),
                baseUrl: activeProfile.baseUrl,
                apiKey: activeProfile.apiKey,
                apiFormat: activeProfile.apiFormat,
                authHeader: activeProfile.authHeader,
                authScheme: activeProfile.authScheme,
                authHeaderValue: activeProfile.authHeaderValue,
                processEnv: process.env,
              }) ?? null
            )
          : buildOpenAICompatibleStartupEnv(activeProfile)
    }
  })()

  if (profileEnv) {
    const startupProfile =
      activeProfile.provider === 'anthropic'
        ? ({
            profile: 'openai' as ProviderProfileStartup,
            env: {
              OPENAI_BASE_URL: activeProfile.baseUrl,
              OPENAI_MODEL: getPrimaryModel(activeProfile.model),
              OPENAI_API_FORMAT: activeProfile.apiFormat,
              OPENAI_AUTH_HEADER: activeProfile.authHeader,
              OPENAI_AUTH_SCHEME: activeProfile.authScheme,
              OPENAI_AUTH_HEADER_VALUE: activeProfile.authHeaderValue,
              OPENAI_API_KEY: activeProfile.apiKey,
            },
          } as const)
        : ({
            profile: activeProfile.provider as ProviderProfileStartup,
            env: profileEnv,
          } as const)

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
