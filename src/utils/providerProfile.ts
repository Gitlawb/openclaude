import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  isCodexBaseUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from '../services/api/providerConfig.js'
import { parseChatgptAccountId } from '../services/api/codexOAuthShared.js'
import {
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  type RecommendationGoal,
} from './providerRecommendation.js'
import { readGeminiAccessToken } from './geminiCredentials.js'
import { getOllamaChatBaseUrl } from './providerDiscovery.js'
import { getPrimaryModel } from './providerModels.js'
import { getProviderValidationError } from './providerValidation.js'
import {
  maskSecretForDisplay,
  redactSecretValueForDisplay,
  sanitizeApiKey,
  sanitizeProviderConfigValue,
} from './providerSecrets.js'

export {
  maskSecretForDisplay,
  redactSecretValueForDisplay,
  sanitizeApiKey,
  sanitizeProviderConfigValue,
} from './providerSecrets.js'
import { isEnvTruthy } from './envUtils.js'

export const PROFILE_FILE_NAME = '.openclaude-profile.json'
export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
export const DEFAULT_MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'
export const DEFAULT_MISTRAL_MODEL = 'devstral-latest'

const PROFILE_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_CREDENTIAL_SOURCE',
  'CHATGPT_ACCOUNT_ID',
  'CODEX_ACCOUNT_ID',
  'GEMINI_API_KEY',
  'GEMINI_AUTH_MODE',
  'GEMINI_ACCESS_TOKEN',
  'GEMINI_MODEL',
  'GEMINI_BASE_URL',
  'GOOGLE_API_KEY',
  'NVIDIA_NIM',
  'NVIDIA_API_KEY',
  'NVIDIA_MODEL',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'MINIMAX_MODEL',
  'MISTRAL_BASE_URL',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
  'BANKR_BASE_URL',
  'BNKR_API_KEY',
  'BANKR_MODEL',
] as const

export type CompatibilityProfileMode =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'mistral'
  | 'github'
  | 'bedrock'
  | 'vertex'

const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'NVIDIA_API_KEY',
  'MINIMAX_API_KEY',
  'MISTRAL_API_KEY',
  'BNKR_API_KEY',
] as const

export type ProviderProfile =
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'codex'
  | 'gemini'
  | 'atomic-chat'
  | 'nvidia-nim'
  | 'minimax'
  | 'mistral'
  | 'github'
  | 'bedrock'
  | 'vertex'

export type ProfileEnv = {
  ANTHROPIC_BASE_URL?: string
  ANTHROPIC_MODEL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BEDROCK_BASE_URL?: string
  ANTHROPIC_VERTEX_BASE_URL?: string
  OPENAI_BASE_URL?: string
  OPENAI_API_BASE?: string
  OPENAI_MODEL?: string
  OPENAI_API_KEY?: string
  CODEX_API_KEY?: string
  CODEX_CREDENTIAL_SOURCE?: 'oauth' | 'existing'
  CHATGPT_ACCOUNT_ID?: string
  CODEX_ACCOUNT_ID?: string
  GEMINI_API_KEY?: string
  GEMINI_AUTH_MODE?: 'api-key' | 'access-token' | 'adc'
  GEMINI_ACCESS_TOKEN?: string
  GEMINI_MODEL?: string
  GEMINI_BASE_URL?: string
  GOOGLE_API_KEY?: string
  NVIDIA_NIM?: string
  NVIDIA_API_KEY?: string
  MINIMAX_API_KEY?: string
  MINIMAX_BASE_URL?: string
  MINIMAX_MODEL?: string
  MISTRAL_BASE_URL?: string
  MISTRAL_API_KEY?: string
  MISTRAL_MODEL?: string
  BANKR_BASE_URL?: string
  BNKR_API_KEY?: string
  BANKR_MODEL?: string
}

export type ProfileFile = {
  profile: ProviderProfile
  env: ProfileEnv
  createdAt: string
}

type SecretValueSource = Partial<
  Record<
    | 'OPENAI_API_KEY'
    | 'CODEX_API_KEY'
    | 'GEMINI_API_KEY'
    | 'GOOGLE_API_KEY'
    | 'NVIDIA_API_KEY'
    | 'MINIMAX_API_KEY'
    | 'MISTRAL_API_KEY'
    | 'BNKR_API_KEY',
    string | undefined
  >
>

type ProfileFileLocation = {
  cwd?: string
  filePath?: string
}

function resolveProfileFilePath(options?: ProfileFileLocation): string {
  if (options?.filePath) {
    return options.filePath
  }

  return resolve(options?.cwd ?? process.cwd(), PROFILE_FILE_NAME)
}

function normalizeProfileModel(
  value: string | undefined | null,
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const primary = getPrimaryModel(trimmed)
  return primary.length > 0 ? primary : undefined
}

export function isProviderProfile(value: unknown): value is ProviderProfile {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'ollama' ||
    value === 'codex' ||
    value === 'gemini' ||
    value === 'atomic-chat' ||
    value === 'nvidia-nim' ||
    value === 'minimax' ||
    value === 'mistral' ||
    value === 'github' ||
    value === 'bedrock' ||
    value === 'vertex'
  )
}

export function buildGithubProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
}): ProfileEnv {
  const env: ProfileEnv = {
    OPENAI_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model),
      ) || 'github:copilot',
  }

  const baseUrl = sanitizeProviderConfigValue(options.baseUrl)
  if (baseUrl) {
    env.OPENAI_BASE_URL = baseUrl
  }

  return env
}

export function buildOllamaProfileEnv(
  model: string,
  options: {
    baseUrl?: string | null
    getOllamaChatBaseUrl: (baseUrl?: string) => string
  },
): ProfileEnv {
  return {
    OPENAI_BASE_URL: options.getOllamaChatBaseUrl(options.baseUrl ?? undefined),
    OPENAI_MODEL: model,
  }
}

export function buildAtomicChatProfileEnv(
  model: string,
  options: {
    baseUrl?: string | null
    getAtomicChatChatBaseUrl: (baseUrl?: string) => string
  },
): ProfileEnv {
  return {
    OPENAI_BASE_URL: options.getAtomicChatChatBaseUrl(options.baseUrl ?? undefined),
    OPENAI_MODEL: model,
  }
}

export function buildBedrockProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
}): ProfileEnv {
  const env: ProfileEnv = {
    ANTHROPIC_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model),
      ) || 'claude-sonnet-4-6',
  }

  const baseUrl = sanitizeProviderConfigValue(options.baseUrl)
  if (baseUrl) {
    env.ANTHROPIC_BEDROCK_BASE_URL = baseUrl
  }

  return env
}

export function buildVertexProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
}): ProfileEnv {
  const env: ProfileEnv = {
    ANTHROPIC_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model),
      ) || 'claude-sonnet-4-6',
  }

  const baseUrl = sanitizeProviderConfigValue(options.baseUrl)
  if (baseUrl) {
    env.ANTHROPIC_VERTEX_BASE_URL = baseUrl
  }

  return env
}

export function buildNvidiaNimProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const key = sanitizeApiKey(options.apiKey ?? processEnv.NVIDIA_API_KEY)
  if (!key) {
    return null
  }

  const defaultBaseUrl = 'https://integrate.api.nvidia.com/v1'
  const secretSource: SecretValueSource = { OPENAI_API_KEY: key }

  return {
    OPENAI_BASE_URL:
      sanitizeProviderConfigValue(options.baseUrl, secretSource) ||
      sanitizeProviderConfigValue(processEnv.OPENAI_BASE_URL, secretSource) ||
      defaultBaseUrl,
    OPENAI_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model, secretSource),
      ) ||
      normalizeProfileModel(
        sanitizeProviderConfigValue(processEnv.OPENAI_MODEL, secretSource),
      ) ||
      'nvidia/llama-3.1-nemotron-70b-instruct',
    OPENAI_API_KEY: key,
    NVIDIA_NIM: '1',
  }
}

export function buildMiniMaxProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const key = sanitizeApiKey(options.apiKey ?? processEnv.MINIMAX_API_KEY)
  if (!key) {
    return null
  }

  const defaultBaseUrl = 'https://api.minimax.io/v1'
  const defaultModel = 'MiniMax-M2.5'
  const secretSource: SecretValueSource = { OPENAI_API_KEY: key }

  return {
    OPENAI_BASE_URL:
      sanitizeProviderConfigValue(options.baseUrl, secretSource) ||
      sanitizeProviderConfigValue(processEnv.OPENAI_BASE_URL, secretSource) ||
      defaultBaseUrl,
    OPENAI_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model, secretSource),
      ) ||
      normalizeProfileModel(
        sanitizeProviderConfigValue(processEnv.OPENAI_MODEL, secretSource),
      ) ||
      defaultModel,
    OPENAI_API_KEY: key,
    MINIMAX_API_KEY: key,
    MINIMAX_BASE_URL: defaultBaseUrl,
    MINIMAX_MODEL: defaultModel,
  }
}

export function buildGeminiProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  authMode?: 'api-key' | 'access-token' | 'adc'
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const authMode = options.authMode ?? 'api-key'
  const key = sanitizeApiKey(
    options.apiKey ??
      processEnv.GEMINI_API_KEY ??
      processEnv.GOOGLE_API_KEY,
  )
  if (authMode === 'api-key' && !key) {
    return null
  }

  const secretSource: SecretValueSource = key ? { GEMINI_API_KEY: key } : {}

  const env: ProfileEnv = {
    GEMINI_AUTH_MODE: authMode,
    GEMINI_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model, secretSource),
      ) ||
      normalizeProfileModel(
        sanitizeProviderConfigValue(processEnv.GEMINI_MODEL, secretSource),
      ) ||
      DEFAULT_GEMINI_MODEL,
  }

  if (authMode === 'api-key' && key) {
    env.GEMINI_API_KEY = key
  }

  const baseUrl =
    sanitizeProviderConfigValue(options.baseUrl, secretSource) ||
    sanitizeProviderConfigValue(processEnv.GEMINI_BASE_URL, secretSource)
  if (baseUrl) {
    env.GEMINI_BASE_URL = baseUrl
  }

  return env
}

export function buildOpenAIProfileEnv(options: {
  goal: RecommendationGoal
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const key = sanitizeApiKey(options.apiKey ?? processEnv.OPENAI_API_KEY)
  if (!key) {
    return null
  }

  const defaultModel = getGoalDefaultOpenAIModel(options.goal)
  const secretSource: SecretValueSource = { OPENAI_API_KEY: key }
  const shellOpenAIModel = normalizeProfileModel(
    sanitizeProviderConfigValue(
      processEnv.OPENAI_MODEL,
      secretSource,
    ),
  )
  const shellOpenAIBaseUrl = sanitizeProviderConfigValue(
    processEnv.OPENAI_BASE_URL,
    secretSource,
  )
  const shellOpenAIRequest = resolveProviderRequest({
    model: shellOpenAIModel,
    baseUrl: shellOpenAIBaseUrl,
    fallbackModel: defaultModel,
  })
  const useShellOpenAIConfig = shellOpenAIRequest.transport === 'chat_completions'

  return {
    OPENAI_BASE_URL:
      sanitizeProviderConfigValue(options.baseUrl, secretSource) ||
      (useShellOpenAIConfig ? shellOpenAIBaseUrl : undefined) ||
      DEFAULT_OPENAI_BASE_URL,
    OPENAI_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model, secretSource),
      ) ||
      (useShellOpenAIConfig ? shellOpenAIModel : undefined) ||
      defaultModel,
    OPENAI_API_KEY: key,
  }
}

export function buildCodexProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  credentialSource?: 'oauth' | 'existing'
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const key = sanitizeApiKey(options.apiKey ?? processEnv.CODEX_API_KEY)
  const credentialEnv = key
    ? ({ ...processEnv, CODEX_API_KEY: key } as NodeJS.ProcessEnv)
    : processEnv
  const credentials = resolveCodexApiCredentials(credentialEnv)
  if (!credentials.apiKey || !credentials.accountId) {
    return null
  }
  const credentialSource =
    options.credentialSource ??
    (credentials.source === 'secure-storage' ? 'oauth' : 'existing')

  const env: ProfileEnv = {
    OPENAI_BASE_URL: options.baseUrl || DEFAULT_CODEX_BASE_URL,
    OPENAI_MODEL: options.model || 'codexplan',
    CODEX_CREDENTIAL_SOURCE: credentialSource,
  }

  if (key) {
    env.CODEX_API_KEY = key
  }

  env.CHATGPT_ACCOUNT_ID = credentials.accountId

  return env
}

export function buildMistralProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const key = sanitizeApiKey(options.apiKey ?? processEnv.MISTRAL_API_KEY)
  if (!key) {
    return null
  }

  const env: ProfileEnv = {
    MISTRAL_API_KEY: key,
    MISTRAL_MODEL:
      normalizeProfileModel(
        sanitizeProviderConfigValue(options.model, { MISTRAL_API_KEY: key }),
      ) ||
      normalizeProfileModel(
        sanitizeProviderConfigValue(
          processEnv.MISTRAL_MODEL,
          { MISTRAL_API_KEY: key },
        ),
      ) ||
      DEFAULT_MISTRAL_MODEL,
  }

  const baseUrl =
    sanitizeProviderConfigValue(options.baseUrl, { MISTRAL_API_KEY: key }) ||
    sanitizeProviderConfigValue(
      processEnv.MISTRAL_BASE_URL,
      { MISTRAL_API_KEY: key },
    )
  if (baseUrl) {
    env.MISTRAL_BASE_URL = baseUrl
  }

  return env
}

export function buildBankrProfileEnv(options: {
  model?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  processEnv?: NodeJS.ProcessEnv
}): ProfileEnv | null {
  const processEnv = options.processEnv ?? process.env
  const key = sanitizeApiKey(options.apiKey ?? processEnv.BNKR_API_KEY)
  if (!key) {
    return null
  }

  const env: ProfileEnv = {
    BNKR_API_KEY: key,
    BANKR_MODEL:
      sanitizeProviderConfigValue(options.model, { BNKR_API_KEY: key }) ||
      sanitizeProviderConfigValue(
        processEnv.BANKR_MODEL,
        { BNKR_API_KEY: key },
      ) ||
      'claude-opus-4.6',
  }

  const baseUrl =
    sanitizeProviderConfigValue(options.baseUrl, { BNKR_API_KEY: key }) ||
    sanitizeProviderConfigValue(
      processEnv.BANKR_BASE_URL,
      { BNKR_API_KEY: key },
    )
  if (baseUrl) {
    env.BANKR_BASE_URL = baseUrl
  }

  return env
}

function getCompatibilityProfileFlag(
  compatibilityMode: CompatibilityProfileMode,
):
  | 'CLAUDE_CODE_USE_OPENAI'
  | 'CLAUDE_CODE_USE_GITHUB'
  | 'CLAUDE_CODE_USE_GEMINI'
  | 'CLAUDE_CODE_USE_MISTRAL'
  | 'CLAUDE_CODE_USE_BEDROCK'
  | 'CLAUDE_CODE_USE_VERTEX'
  | undefined {
  switch (compatibilityMode) {
    case 'openai':
      return 'CLAUDE_CODE_USE_OPENAI'
    case 'github':
      return 'CLAUDE_CODE_USE_GITHUB'
    case 'gemini':
      return 'CLAUDE_CODE_USE_GEMINI'
    case 'mistral':
      return 'CLAUDE_CODE_USE_MISTRAL'
    case 'bedrock':
      return 'CLAUDE_CODE_USE_BEDROCK'
    case 'vertex':
      return 'CLAUDE_CODE_USE_VERTEX'
    default:
      return undefined
  }
}

export function clearManagedProfileEnv(
  targetEnv: NodeJS.ProcessEnv,
): void {
  for (const key of PROFILE_ENV_KEYS) {
    delete targetEnv[key]
  }
}

export function buildCompatibilityProcessEnv(options: {
  compatibilityMode: CompatibilityProfileMode
  profileEnv: ProfileEnv
  processEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const env = { ...(options.processEnv ?? process.env) }
  const nextEnv: NodeJS.ProcessEnv = { ...options.profileEnv }
  const flag = getCompatibilityProfileFlag(options.compatibilityMode)

  if (flag) {
    nextEnv[flag] = '1'
  }

  applyProfileEnvToProcessEnv(env, nextEnv)
  return env
}

export function buildCodexOAuthProfileEnv(
  tokens: {
    accessToken: string
    idToken?: string
    accountId?: string
  },
): ProfileEnv | null {
  const accountId =
    tokens.accountId ??
    parseChatgptAccountId(tokens.idToken) ??
    parseChatgptAccountId(tokens.accessToken)

  if (!accountId) {
    return null
  }

  return {
    OPENAI_BASE_URL: DEFAULT_CODEX_BASE_URL,
    OPENAI_MODEL: 'codexplan',
    CHATGPT_ACCOUNT_ID: accountId,
    CODEX_CREDENTIAL_SOURCE: 'oauth',
  }
}

export function createProfileFile(
  profile: ProviderProfile,
  env: ProfileEnv,
): ProfileFile {
  return {
    profile,
    env,
    createdAt: new Date().toISOString(),
  }
}

export function isPersistedCodexOAuthProfile(
  persisted: ProfileFile | null,
): boolean {
  return (
    persisted?.profile === 'codex' &&
    persisted.env.CODEX_CREDENTIAL_SOURCE === 'oauth'
  )
}

export function clearPersistedCodexOAuthProfile(
  options?: ProfileFileLocation,
): string | null {
  const persisted = loadProfileFile(options)
  if (!isPersistedCodexOAuthProfile(persisted)) {
    return null
  }

  return deleteProfileFile(options)
}

export function loadProfileFile(options?: ProfileFileLocation): ProfileFile | null {
  const filePath = resolveProfileFilePath(options)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ProfileFile>
    if (!isProviderProfile(parsed.profile) || !parsed.env || typeof parsed.env !== 'object') {
      return null
    }

    return {
      profile: parsed.profile,
      env: parsed.env,
      createdAt:
        typeof parsed.createdAt === 'string'
          ? parsed.createdAt
          : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function saveProfileFile(
  profileFile: ProfileFile,
  options?: ProfileFileLocation,
): string {
  const filePath = resolveProfileFilePath(options)
  writeFileSync(filePath, JSON.stringify(profileFile, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  return filePath
}

export function deleteProfileFile(options?: ProfileFileLocation): string {
  const filePath = resolveProfileFilePath(options)
  rmSync(filePath, { force: true })
  return filePath
}

export function hasExplicitProviderSelection(
  processEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  // If env was already applied from a provider profile, preserve it.
  if (processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1') {
    return true
  }

  return (
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_OPENAI) ||
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB) ||
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_GEMINI) ||
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_MISTRAL) ||
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(processEnv.CLAUDE_CODE_USE_FOUNDRY)
  )
}

export function selectAutoProfile(
  recommendedOllamaModel: string | null,
): ProviderProfile {
  return recommendedOllamaModel ? 'ollama' : 'openai'
}

export async function buildLaunchEnv(options: {
  profile: ProviderProfile
  persisted: ProfileFile | null
  goal: RecommendationGoal
  processEnv?: NodeJS.ProcessEnv
  getOllamaChatBaseUrl?: (baseUrl?: string) => string
  resolveOllamaDefaultModel?: (goal: RecommendationGoal) => Promise<string>
  getAtomicChatChatBaseUrl?: (baseUrl?: string) => string
  resolveAtomicChatDefaultModel?: () => Promise<string | null>
  readGeminiAccessToken?: () => string | undefined
}): Promise<NodeJS.ProcessEnv> {
  const processEnv = options.processEnv ?? process.env
  const persistedEnv =
    options.persisted?.profile === options.profile
      ? options.persisted.env ?? {}
      : {}
  const persistedOpenAIModel = normalizeProfileModel(
    sanitizeProviderConfigValue(
      persistedEnv.OPENAI_MODEL,
      persistedEnv,
    ),
  )
  const persistedOpenAIBaseUrl = sanitizeProviderConfigValue(
    persistedEnv.OPENAI_BASE_URL,
    persistedEnv,
  )
  const shellOpenAIModel = normalizeProfileModel(
    sanitizeProviderConfigValue(
      processEnv.OPENAI_MODEL,
      processEnv as SecretValueSource,
    ),
  )
  const shellOpenAIBaseUrl = sanitizeProviderConfigValue(
    processEnv.OPENAI_BASE_URL,
    processEnv as SecretValueSource,
  )
  const persistedGeminiModel = normalizeProfileModel(
    sanitizeProviderConfigValue(
      persistedEnv.GEMINI_MODEL,
      persistedEnv,
    ),
  )
  const persistedGeminiBaseUrl = sanitizeProviderConfigValue(
    persistedEnv.GEMINI_BASE_URL,
    persistedEnv,
  )
  const shellGeminiModel = normalizeProfileModel(
    sanitizeProviderConfigValue(
      processEnv.GEMINI_MODEL,
      processEnv as SecretValueSource,
    ),
  )
  const shellGeminiBaseUrl = sanitizeProviderConfigValue(
    processEnv.GEMINI_BASE_URL,
    processEnv as SecretValueSource,
  )
  const shellGeminiAccessToken =
    processEnv.GEMINI_ACCESS_TOKEN?.trim() || undefined
  const storedGeminiAccessToken =
    options.readGeminiAccessToken?.() ?? readGeminiAccessToken()

  const shellGeminiKey = sanitizeApiKey(
    processEnv.GEMINI_API_KEY ?? processEnv.GOOGLE_API_KEY,
  )
  const persistedGeminiKey = sanitizeApiKey(persistedEnv.GEMINI_API_KEY)
  const persistedGeminiAuthMode = persistedEnv.GEMINI_AUTH_MODE

  if (hasExplicitProviderSelection(processEnv)) {
    const explicitProfileOverrides: Array<[string, ProviderProfile]> = [
      ['CLAUDE_CODE_USE_GITHUB', 'github'],
      ['CLAUDE_CODE_USE_BEDROCK', 'bedrock'],
      ['CLAUDE_CODE_USE_VERTEX', 'vertex'],
      ['CLAUDE_CODE_USE_MISTRAL', 'mistral'],
      ['CLAUDE_CODE_USE_GEMINI', 'gemini'],
      ['CLAUDE_CODE_USE_OPENAI', 'openai'],
    ]

    for (const [envKey, provider] of explicitProfileOverrides) {
      if (isEnvTruthy(processEnv[envKey])) {
        options.profile = provider
        break
      }
    }
  }

  if (options.profile === 'github') {
    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'github',
      profileEnv: buildGithubProfileEnv({
        model: shellOpenAIModel || persistedOpenAIModel || 'github:copilot',
        baseUrl: shellOpenAIBaseUrl || persistedOpenAIBaseUrl,
      }),
    })
  }

  if (options.profile === 'anthropic') {
    const anthropicBaseUrl =
      sanitizeProviderConfigValue(processEnv.ANTHROPIC_BASE_URL) ||
      sanitizeProviderConfigValue(persistedEnv.ANTHROPIC_BASE_URL)
    const anthropicApiKey =
      sanitizeApiKey(processEnv.ANTHROPIC_API_KEY) ||
      sanitizeApiKey(persistedEnv.ANTHROPIC_API_KEY)

    return {
      ...(anthropicBaseUrl
        ? { ANTHROPIC_BASE_URL: anthropicBaseUrl }
        : {}),
      ANTHROPIC_MODEL:
        normalizeProfileModel(
          sanitizeProviderConfigValue(processEnv.ANTHROPIC_MODEL),
        ) ||
        normalizeProfileModel(
          sanitizeProviderConfigValue(persistedEnv.ANTHROPIC_MODEL),
        ) ||
        'claude-sonnet-4-6',
      ...(anthropicApiKey
        ? { ANTHROPIC_API_KEY: anthropicApiKey }
        : {}),
    }
  }

  if (options.profile === 'bedrock') {
    const bedrockBaseUrl =
      sanitizeProviderConfigValue(processEnv.ANTHROPIC_BEDROCK_BASE_URL) ||
      sanitizeProviderConfigValue(persistedEnv.ANTHROPIC_BEDROCK_BASE_URL)

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'bedrock',
      profileEnv: buildBedrockProfileEnv({
        model:
          normalizeProfileModel(
            sanitizeProviderConfigValue(processEnv.ANTHROPIC_MODEL),
          ) ||
          normalizeProfileModel(
            sanitizeProviderConfigValue(persistedEnv.ANTHROPIC_MODEL),
          ) ||
          'claude-sonnet-4-6',
        baseUrl: bedrockBaseUrl,
      }),
    })
  }

  if (options.profile === 'vertex') {
    const vertexBaseUrl =
      sanitizeProviderConfigValue(processEnv.ANTHROPIC_VERTEX_BASE_URL) ||
      sanitizeProviderConfigValue(persistedEnv.ANTHROPIC_VERTEX_BASE_URL)

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'vertex',
      profileEnv: buildVertexProfileEnv({
        model:
          normalizeProfileModel(
            sanitizeProviderConfigValue(processEnv.ANTHROPIC_MODEL),
          ) ||
          normalizeProfileModel(
            sanitizeProviderConfigValue(persistedEnv.ANTHROPIC_MODEL),
          ) ||
          'claude-sonnet-4-6',
        baseUrl: vertexBaseUrl,
      }),
    })
  }

  if (options.profile === 'gemini') {
    const env: ProfileEnv = {
      GEMINI_MODEL:
        shellGeminiModel ||
        persistedGeminiModel ||
        DEFAULT_GEMINI_MODEL,
      GEMINI_BASE_URL:
        shellGeminiBaseUrl ||
        persistedGeminiBaseUrl ||
        DEFAULT_GEMINI_BASE_URL,
    }

    const geminiAuthMode =
      persistedGeminiAuthMode === 'access-token' ||
      persistedGeminiAuthMode === 'adc'
        ? persistedGeminiAuthMode
        : 'api-key'
    const geminiKey = shellGeminiKey || persistedGeminiKey
    if (geminiAuthMode === 'api-key' && geminiKey) {
      env.GEMINI_API_KEY = geminiKey
    }
    env.GEMINI_AUTH_MODE = geminiAuthMode
    if (geminiAuthMode === 'access-token') {
      const geminiAccessToken =
        shellGeminiAccessToken || storedGeminiAccessToken
      if (geminiAccessToken) {
        env.GEMINI_ACCESS_TOKEN = geminiAccessToken
      }
    }

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'gemini',
      profileEnv: env,
    })
  }

  if (options.profile === 'mistral') {
    const shellMistralModel = normalizeProfileModel(
      sanitizeProviderConfigValue(
        processEnv.MISTRAL_MODEL,
      ),
    )
    const persistedMistralModel = normalizeProfileModel(
      sanitizeProviderConfigValue(
        persistedEnv.MISTRAL_MODEL,
      ),
    )
    const shellMistralBaseUrl = sanitizeProviderConfigValue(
      processEnv.MISTRAL_BASE_URL,
    )
    const persistedMistralBaseUrl = sanitizeProviderConfigValue(
      persistedEnv.MISTRAL_BASE_URL,
    )

    const shellMistralKey = sanitizeApiKey(
      processEnv.MISTRAL_API_KEY,
    )
    const persistedMistralKey = sanitizeApiKey(persistedEnv.MISTRAL_API_KEY)
    const mistralKey = shellMistralKey || persistedMistralKey

    const env: ProfileEnv = {
      MISTRAL_MODEL:
        shellMistralModel || persistedMistralModel || DEFAULT_MISTRAL_MODEL,
    }

    if (mistralKey) {
      env.MISTRAL_API_KEY = mistralKey
    }

    if (shellMistralBaseUrl || persistedMistralBaseUrl) {
      env.MISTRAL_BASE_URL = shellMistralBaseUrl || persistedMistralBaseUrl
    }

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'mistral',
      profileEnv: env,
    })
  }

  if (options.profile === 'ollama') {
    const getOllamaBaseUrl =
      options.getOllamaChatBaseUrl ?? (() => 'http://localhost:11434/v1')
    const resolveOllamaModel =
      options.resolveOllamaDefaultModel ?? (async () => 'llama3.1:8b')

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'openai',
      profileEnv: {
        OPENAI_BASE_URL: persistedOpenAIBaseUrl || getOllamaBaseUrl(),
        OPENAI_MODEL:
          persistedOpenAIModel ||
          (await resolveOllamaModel(options.goal)),
      },
    })
  }

  if (options.profile === 'atomic-chat') {
    const getAtomicChatBaseUrl =
      options.getAtomicChatChatBaseUrl ?? (() => 'http://127.0.0.1:1337/v1')
    const resolveModel =
      options.resolveAtomicChatDefaultModel ?? (async () => null as string | null)

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'openai',
      profileEnv: {
        OPENAI_BASE_URL: persistedEnv.OPENAI_BASE_URL || getAtomicChatBaseUrl(),
        OPENAI_MODEL:
          persistedEnv.OPENAI_MODEL ||
          (await resolveModel()) ||
          '',
      },
    })
  }

  if (options.profile === 'codex') {
    const codexKey =
      sanitizeApiKey(processEnv.CODEX_API_KEY) ||
      sanitizeApiKey(persistedEnv.CODEX_API_KEY)
    const liveCodexCredentials = resolveCodexApiCredentials(processEnv)
    const codexAccountId =
      processEnv.CHATGPT_ACCOUNT_ID ||
      processEnv.CODEX_ACCOUNT_ID ||
      liveCodexCredentials.accountId ||
      persistedEnv.CHATGPT_ACCOUNT_ID ||
      persistedEnv.CODEX_ACCOUNT_ID

    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'openai',
      profileEnv: {
        OPENAI_BASE_URL:
          persistedOpenAIBaseUrl && isCodexBaseUrl(persistedOpenAIBaseUrl)
            ? persistedOpenAIBaseUrl
            : DEFAULT_CODEX_BASE_URL,
        OPENAI_MODEL: persistedOpenAIModel || 'codexplan',
        ...(codexKey ? { CODEX_API_KEY: codexKey } : {}),
        ...(codexAccountId ? { CHATGPT_ACCOUNT_ID: codexAccountId } : {}),
      },
    })
  }

  const defaultOpenAIModel = getGoalDefaultOpenAIModel(options.goal)
  const shellOpenAIRequest = resolveProviderRequest({
    model: shellOpenAIModel,
    baseUrl: shellOpenAIBaseUrl,
    fallbackModel: defaultOpenAIModel,
  })
  const persistedOpenAIRequest = resolveProviderRequest({
    model: persistedOpenAIModel,
    baseUrl: persistedOpenAIBaseUrl,
    fallbackModel: defaultOpenAIModel,
  })
  const useShellOpenAIConfig = shellOpenAIRequest.transport === 'chat_completions'
  const usePersistedOpenAIConfig =
    (!persistedOpenAIModel && !persistedOpenAIBaseUrl) ||
    persistedOpenAIRequest.transport === 'chat_completions'

  const env: ProfileEnv = {
    OPENAI_BASE_URL:
      (useShellOpenAIConfig ? shellOpenAIBaseUrl : undefined) ||
      (usePersistedOpenAIConfig ? persistedOpenAIBaseUrl : undefined) ||
      DEFAULT_OPENAI_BASE_URL,
    OPENAI_MODEL:
      (useShellOpenAIConfig ? shellOpenAIModel : undefined) ||
      (usePersistedOpenAIConfig ? persistedOpenAIModel : undefined) ||
      defaultOpenAIModel,
  }
  const openAIKey = processEnv.OPENAI_API_KEY || persistedEnv.OPENAI_API_KEY
  if (openAIKey) {
    env.OPENAI_API_KEY = openAIKey
  }

  return buildCompatibilityProcessEnv({
    processEnv,
    compatibilityMode: 'openai',
    profileEnv: env,
  })
}

export async function buildStartupEnvFromProfile(options?: {
  persisted?: ProfileFile | null
  goal?: RecommendationGoal
  processEnv?: NodeJS.ProcessEnv
  getOllamaChatBaseUrl?: (baseUrl?: string) => string
  resolveOllamaDefaultModel?: (goal: RecommendationGoal) => Promise<string>
  readGeminiAccessToken?: () => string | undefined
}): Promise<NodeJS.ProcessEnv> {
  const processEnv = options?.processEnv ?? process.env
  const persisted = options?.persisted ?? loadProfileFile()

  const profileManagedEnv = processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1'

  // The legacy single-profile file (~/.openclaude-profile.json) is a
  // first-run / fallback mechanism. The newer plural provider-profile
  // system (`/provider` presets + activeProviderProfileId in config) is
  // applied earlier in the bootstrap via applyActiveProviderProfileFromConfig
  // and signals completion with CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED=1.
  //
  // If the plural system has already set env, trust it — do NOT overlay the
  // legacy file. addProviderProfile() does not sync the legacy file, so a
  // stale legacy file (e.g. OpenAI defaults from an earlier manual setup)
  // would otherwise overwrite the correct plural env and surface as the
  // "banner shows gpt-4o / api.openai.com even though my saved profile is
  // Moonshot" bug.
  if (profileManagedEnv) {
    return processEnv
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB)) {
    return processEnv
  }

  if (!persisted) {
    return processEnv
  }

  return buildLaunchEnv({
    profile: persisted.profile,
    persisted,
    goal:
      options?.goal ??
      normalizeRecommendationGoal(processEnv.OPENCLAUDE_PROFILE_GOAL),
    processEnv,
    getOllamaChatBaseUrl:
      options?.getOllamaChatBaseUrl ?? getOllamaChatBaseUrl,
    resolveOllamaDefaultModel: options?.resolveOllamaDefaultModel,
    readGeminiAccessToken: options?.readGeminiAccessToken,
  })
}

export function applyProfileEnvToProcessEnv(
  targetEnv: NodeJS.ProcessEnv,
  nextEnv: NodeJS.ProcessEnv,
): void {
  clearManagedProfileEnv(targetEnv)
  Object.assign(targetEnv, nextEnv)
}

export async function applySavedProfileToCurrentSession(options: {
  profileFile: ProfileFile
  processEnv?: NodeJS.ProcessEnv
}): Promise<string | null> {
  const processEnv = options.processEnv ?? process.env
  const hasExplicitSelection = hasExplicitProviderSelection(processEnv)
  const profileManagedEnv =
    processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1'

  if (options.profileFile.profile === 'codex' && hasExplicitSelection) {
    const explicitEnv = await buildLaunchEnv({
      profile: options.profileFile.profile,
      persisted: options.profileFile,
      goal: normalizeRecommendationGoal(processEnv.OPENCLAUDE_PROFILE_GOAL),
      processEnv,
      getOllamaChatBaseUrl,
      readGeminiAccessToken,
    })
    delete explicitEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete explicitEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    const validationError = await getProviderValidationError(explicitEnv)

    if (profileManagedEnv) {
      delete processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
      delete processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
      applyProfileEnvToProcessEnv(processEnv, explicitEnv)
      return validationError
    }

    return (
      validationError ??
      'current session already has an explicit provider selection'
    )
  }

  const baseEnv = { ...processEnv }
  const isCodexOAuthProfile =
    options.profileFile.profile === 'codex' &&
    options.profileFile.env.CODEX_CREDENTIAL_SOURCE === 'oauth'

  delete baseEnv.CLAUDE_CODE_USE_OPENAI
  delete baseEnv.CLAUDE_CODE_USE_GITHUB
  delete baseEnv.CLAUDE_CODE_USE_GEMINI
  delete baseEnv.CLAUDE_CODE_USE_MISTRAL
  delete baseEnv.CLAUDE_CODE_USE_BEDROCK
  delete baseEnv.CLAUDE_CODE_USE_VERTEX
  delete baseEnv.CLAUDE_CODE_USE_FOUNDRY
  delete baseEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete baseEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID

  if (isCodexOAuthProfile) {
    delete baseEnv.CODEX_API_KEY
    delete baseEnv.CODEX_ACCOUNT_ID
    delete baseEnv.CHATGPT_ACCOUNT_ID
  }

  const nextEnv = await buildLaunchEnv({
    profile: options.profileFile.profile,
    persisted: options.profileFile,
    goal: normalizeRecommendationGoal(processEnv.OPENCLAUDE_PROFILE_GOAL),
    processEnv: baseEnv,
    getOllamaChatBaseUrl,
    readGeminiAccessToken,
  })
  const validationError = await getProviderValidationError(nextEnv)
  if (validationError) {
    return validationError
  }

  delete processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
  applyProfileEnvToProcessEnv(processEnv, nextEnv)
  return null
}
