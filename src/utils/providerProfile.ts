import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  isCodexBaseUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from '../services/api/providerConfig.ts'
import {
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  type RecommendationGoal,
} from './providerRecommendation.ts'
import { readGeminiAccessToken } from './geminiCredentials.ts'
import { getOllamaChatBaseUrl } from './providerDiscovery.ts'

export const PROFILE_FILE_NAME = '.openclaude-profile.json'
export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
export const DEFAULT_MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'
export const DEFAULT_MISTRAL_MODEL = 'devstral-latest'

const PROFILE_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CHATGPT_ACCOUNT_ID',
  'CODEX_ACCOUNT_ID',
  'GEMINI_API_KEY',
  'GEMINI_AUTH_MODE',
  'GEMINI_ACCESS_TOKEN',
  'GEMINI_MODEL',
  'GEMINI_BASE_URL',
  'GOOGLE_API_KEY',
  'MISTRAL_BASE_URL',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
] as const

const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
] as const

export type ProviderProfile = 'openai' | 'ollama' | 'codex' | 'gemini' | 'atomic-chat' | 'mistral'

export type ProfileEnv = {
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  OPENAI_API_KEY?: string
  CODEX_API_KEY?: string
  CHATGPT_ACCOUNT_ID?: string
  CODEX_ACCOUNT_ID?: string
  GEMINI_API_KEY?: string
  GEMINI_AUTH_MODE?: 'api-key' | 'access-token' | 'adc'
  GEMINI_MODEL?: string
  GEMINI_BASE_URL?: string
  MISTRAL_BASE_URL?: string
  MISTRAL_API_KEY?: string
  MISTRAL_MODEL?: string
}

export type ProfileFile = {
  profile: ProviderProfile
  env: ProfileEnv
  createdAt: string
}

type SecretValueSource = Partial<
  Pick<
    NodeJS.ProcessEnv & ProfileEnv,
    (typeof SECRET_ENV_KEYS)[number]
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

export function isProviderProfile(value: unknown): value is ProviderProfile {
  return (
    value === 'openai' ||
    value === 'ollama' ||
    value === 'codex' ||
    value === 'gemini' ||
    value === 'atomic-chat' ||
    value === 'mistral'
  )
}

export function sanitizeApiKey(
  key: string | null | undefined,
): string | undefined {
  if (!key || key === 'SUA_CHAVE') return undefined
  return key
}

function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (trimmed.startsWith('sk-') || trimmed.startsWith('sk-ant-')) {
    return true
  }

  if (trimmed.startsWith('AIza')) {
    return true
  }

  return false
}

function collectSecretValues(
  sources: Array<SecretValueSource | null | undefined>,
): string[] {
  const values = new Set<string>()

  for (const source of sources) {
    if (!source) continue

    for (const key of SECRET_ENV_KEYS) {
      const value = sanitizeApiKey(source[key])
      if (value) {
        values.add(value)
      }
    }
  }

  return [...values]
}

export function maskSecretForDisplay(
  value: string | null | undefined,
): string | undefined {
  const sanitized = sanitizeApiKey(value)
  if (!sanitized) return undefined

  if (sanitized.length <= 8) {
    return 'configured'
  }

  if (sanitized.startsWith('sk-')) {
    return `${sanitized.slice(0, 3)}...${sanitized.slice(-4)}`
  }

  if (sanitized.startsWith('AIza')) {
    return `${sanitized.slice(0, 4)}...${sanitized.slice(-4)}`
  }

  return `${sanitized.slice(0, 2)}...${sanitized.slice(-4)}`
}

export function redactSecretValueForDisplay(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return trimmed

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return maskSecretForDisplay(trimmed) ?? 'configured'
  }

  return trimmed
}

export function sanitizeProviderConfigValue(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return undefined
  }

  return trimmed
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

  const env: ProfileEnv = {
    GEMINI_AUTH_MODE: authMode,
    GEMINI_MODEL:
      sanitizeProviderConfigValue(options.model, { GEMINI_API_KEY: key }, processEnv) ||
      sanitizeProviderConfigValue(
        processEnv.GEMINI_MODEL,
        { GEMINI_API_KEY: key },
        processEnv,
      ) ||
      DEFAULT_GEMINI_MODEL,
  }

  if (authMode === 'api-key' && key) {
    env.GEMINI_API_KEY = key
  }

  const baseUrl =
    sanitizeProviderConfigValue(options.baseUrl, { GEMINI_API_KEY: key }, processEnv) ||
    sanitizeProviderConfigValue(
      processEnv.GEMINI_BASE_URL,
      { GEMINI_API_KEY: key },
      processEnv,
    )
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
  const shellOpenAIModel = sanitizeProviderConfigValue(
    processEnv.OPENAI_MODEL,
    { OPENAI_API_KEY: key },
    processEnv,
  )
  const shellOpenAIBaseUrl = sanitizeProviderConfigValue(
    processEnv.OPENAI_BASE_URL,
    { OPENAI_API_KEY: key },
    processEnv,
  )
  const shellOpenAIRequest = resolveProviderRequest({
    model: shellOpenAIModel,
    baseUrl: shellOpenAIBaseUrl,
    fallbackModel: defaultModel,
  })
  const useShellOpenAIConfig = shellOpenAIRequest.transport === 'chat_completions'

  return {
    OPENAI_BASE_URL:
      sanitizeProviderConfigValue(
        options.baseUrl,
        { OPENAI_API_KEY: key },
        processEnv,
      ) ||
      (useShellOpenAIConfig ? shellOpenAIBaseUrl : undefined) ||
      DEFAULT_OPENAI_BASE_URL,
    OPENAI_MODEL:
      sanitizeProviderConfigValue(
        options.model,
        { OPENAI_API_KEY: key },
        processEnv,
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

  const env: ProfileEnv = {
    OPENAI_BASE_URL: options.baseUrl || DEFAULT_CODEX_BASE_URL,
    OPENAI_MODEL: options.model || 'codexplan',
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
      sanitizeProviderConfigValue(options.model, { MISTRAL_API_KEY: key }, processEnv) ||
      sanitizeProviderConfigValue(
        processEnv.MISTRAL_MODEL,
        { MISTRAL_API_KEY: key },
        processEnv,
      ) ||
      DEFAULT_MISTRAL_MODEL,
  }

  const baseUrl =
    sanitizeProviderConfigValue(options.baseUrl, { MISTRAL_API_KEY: key }, processEnv) ||
    sanitizeProviderConfigValue(
      processEnv.MISTRAL_BASE_URL,
      { MISTRAL_API_KEY: key },
      processEnv,
    )
  if (baseUrl) {
    env.MISTRAL_BASE_URL = baseUrl
  }

  return env
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
    processEnv.CLAUDE_CODE_USE_OPENAI !== undefined ||
    processEnv.CLAUDE_CODE_USE_GITHUB !== undefined ||
    processEnv.CLAUDE_CODE_USE_GEMINI !== undefined ||
    processEnv.CLAUDE_CODE_USE_MISTRAL !== undefined ||
    processEnv.CLAUDE_CODE_USE_BEDROCK !== undefined ||
    processEnv.CLAUDE_CODE_USE_VERTEX !== undefined ||
    processEnv.CLAUDE_CODE_USE_FOUNDRY !== undefined
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
  const persistedOpenAIModel = sanitizeProviderConfigValue(
    persistedEnv.OPENAI_MODEL,
    persistedEnv,
  )
  const persistedOpenAIBaseUrl = sanitizeProviderConfigValue(
    persistedEnv.OPENAI_BASE_URL,
    persistedEnv,
  )
  const shellOpenAIModel = sanitizeProviderConfigValue(
    processEnv.OPENAI_MODEL,
    processEnv,
  )
  const shellOpenAIBaseUrl = sanitizeProviderConfigValue(
    processEnv.OPENAI_BASE_URL,
    processEnv,
  )
  const persistedGeminiModel = sanitizeProviderConfigValue(
    persistedEnv.GEMINI_MODEL,
    persistedEnv,
  )
  const persistedGeminiBaseUrl = sanitizeProviderConfigValue(
    persistedEnv.GEMINI_BASE_URL,
    persistedEnv,
  )
  const shellGeminiModel = sanitizeProviderConfigValue(
    processEnv.GEMINI_MODEL,
    processEnv,
  )
  const shellGeminiBaseUrl = sanitizeProviderConfigValue(
    processEnv.GEMINI_BASE_URL,
    processEnv,
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

  if (options.profile === 'gemini') {
    const env: NodeJS.ProcessEnv = {
      ...processEnv,
      CLAUDE_CODE_USE_GEMINI: '1',
    }

    delete env.CLAUDE_CODE_USE_OPENAI
    delete env.CLAUDE_CODE_USE_GITHUB

    env.GEMINI_MODEL =
      shellGeminiModel ||
      persistedGeminiModel ||
      DEFAULT_GEMINI_MODEL
    env.GEMINI_BASE_URL =
      shellGeminiBaseUrl ||
      persistedGeminiBaseUrl ||
      DEFAULT_GEMINI_BASE_URL

    const geminiAuthMode =
      persistedGeminiAuthMode === 'access-token' ||
      persistedGeminiAuthMode === 'adc'
        ? persistedGeminiAuthMode
        : 'api-key'
    const geminiKey = shellGeminiKey || persistedGeminiKey
    if (geminiAuthMode === 'api-key' && geminiKey) {
      env.GEMINI_API_KEY = geminiKey
    } else {
      delete env.GEMINI_API_KEY
    }
    env.GEMINI_AUTH_MODE = geminiAuthMode
    if (geminiAuthMode === 'access-token') {
      const geminiAccessToken =
        shellGeminiAccessToken || storedGeminiAccessToken
      if (geminiAccessToken) {
        env.GEMINI_ACCESS_TOKEN = geminiAccessToken
      } else {
        delete env.GEMINI_ACCESS_TOKEN
      }
    } else {
      delete env.GEMINI_ACCESS_TOKEN
    }

    delete env.GOOGLE_API_KEY
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_MODEL
    delete env.OPENAI_API_KEY
    delete env.CODEX_API_KEY
    delete env.CHATGPT_ACCOUNT_ID
    delete env.CODEX_ACCOUNT_ID

    return env
  }

  if (options.profile === 'mistral') {
    const env: NodeJS.ProcessEnv = {
      ...processEnv,
      CLAUDE_CODE_USE_MISTRAL: '1',
    }

    delete env.CLAUDE_CODE_USE_OPENAI
    delete env.CLAUDE_CODE_USE_GITHUB
    delete env.CLAUDE_CODE_USE_GEMINI
    delete env.CLAUDE_CODE_USE_BEDROCK
    delete env.CLAUDE_CODE_USE_VERTEX
    delete env.CLAUDE_CODE_USE_FOUNDRY

    const shellMistralModel = sanitizeProviderConfigValue(
      processEnv.MISTRAL_MODEL,
      processEnv,
    )
    const persistedMistralModel = sanitizeProviderConfigValue(
      persistedEnv.MISTRAL_MODEL,
      persistedEnv,
    )
    const shellMistralBaseUrl = sanitizeProviderConfigValue(
      processEnv.MISTRAL_BASE_URL,
      processEnv,
    )
    const persistedMistralBaseUrl = sanitizeProviderConfigValue(
      persistedEnv.MISTRAL_BASE_URL,
      persistedEnv,
    )

    env.MISTRAL_MODEL =
      shellMistralModel || persistedMistralModel || DEFAULT_MISTRAL_MODEL

    const shellMistralKey = sanitizeApiKey(
      processEnv.MISTRAL_API_KEY,
    )
    const persistedMistralKey = sanitizeApiKey(persistedEnv.MISTRAL_API_KEY)
    const mistralKey = shellMistralKey || persistedMistralKey

    if (mistralKey) {
      env.MISTRAL_API_KEY = mistralKey
    } else {
      delete env.MISTRAL_API_KEY
    }

    if (shellMistralBaseUrl || persistedMistralBaseUrl) {
      env.MISTRAL_BASE_URL = shellMistralBaseUrl || persistedMistralBaseUrl
    } else {
      delete env.MISTRAL_BASE_URL
    }

    delete env.GEMINI_API_KEY
    delete env.GEMINI_AUTH_MODE
    delete env.GEMINI_ACCESS_TOKEN
    delete env.GEMINI_MODEL
    delete env.GEMINI_BASE_URL
    delete env.GOOGLE_API_KEY
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_MODEL
    delete env.OPENAI_API_KEY
    delete env.CODEX_API_KEY
    delete env.CHATGPT_ACCOUNT_ID
    delete env.CODEX_ACCOUNT_ID

    return env
  }

  const env: NodeJS.ProcessEnv = {
    ...processEnv,
    CLAUDE_CODE_USE_OPENAI: '1',
  }

  delete env.CLAUDE_CODE_USE_MISTRAL
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  delete env.CLAUDE_CODE_USE_FOUNDRY
  delete env.CLAUDE_CODE_USE_GEMINI
  delete env.CLAUDE_CODE_USE_GITHUB
  delete env.GEMINI_API_KEY
  delete env.GEMINI_AUTH_MODE
  delete env.GEMINI_ACCESS_TOKEN
  delete env.GEMINI_MODEL
  delete env.GEMINI_BASE_URL
  delete env.GOOGLE_API_KEY

  if (options.profile === 'ollama') {
    const getOllamaBaseUrl =
      options.getOllamaChatBaseUrl ?? (() => 'http://localhost:11434/v1')
    const resolveOllamaModel =
      options.resolveOllamaDefaultModel ?? (async () => 'llama3.1:8b')

    env.OPENAI_BASE_URL = persistedOpenAIBaseUrl || getOllamaBaseUrl()
    env.OPENAI_MODEL =
      persistedOpenAIModel ||
      (await resolveOllamaModel(options.goal))

    delete env.OPENAI_API_KEY
    delete env.CODEX_API_KEY
    delete env.CHATGPT_ACCOUNT_ID
    delete env.CODEX_ACCOUNT_ID

    return env
  }

  if (options.profile === 'atomic-chat') {
    const getAtomicChatBaseUrl =
      options.getAtomicChatChatBaseUrl ?? (() => 'http://127.0.0.1:1337/v1')
    const resolveModel =
      options.resolveAtomicChatDefaultModel ?? (async () => null as string | null)

    env.OPENAI_BASE_URL = persistedEnv.OPENAI_BASE_URL || getAtomicChatBaseUrl()
    env.OPENAI_MODEL =
      persistedEnv.OPENAI_MODEL ||
      (await resolveModel()) ||
      ''

    delete env.OPENAI_API_KEY
    delete env.CODEX_API_KEY
    delete env.CHATGPT_ACCOUNT_ID
    delete env.CODEX_ACCOUNT_ID

    return env
  }

  if (options.profile === 'codex') {
    env.OPENAI_BASE_URL =
      persistedOpenAIBaseUrl && isCodexBaseUrl(persistedOpenAIBaseUrl)
        ? persistedOpenAIBaseUrl
        : DEFAULT_CODEX_BASE_URL
    env.OPENAI_MODEL = persistedOpenAIModel || 'codexplan'
    delete env.OPENAI_API_KEY

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
    if (codexKey) {
      env.CODEX_API_KEY = codexKey
    } else {
      delete env.CODEX_API_KEY
    }

    if (codexAccountId) {
      env.CHATGPT_ACCOUNT_ID = codexAccountId
    } else {
      delete env.CHATGPT_ACCOUNT_ID
    }
    delete env.CODEX_ACCOUNT_ID

    return env
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

  env.OPENAI_BASE_URL =
    (useShellOpenAIConfig ? shellOpenAIBaseUrl : undefined) ||
    (usePersistedOpenAIConfig ? persistedOpenAIBaseUrl : undefined) ||
    DEFAULT_OPENAI_BASE_URL
  env.OPENAI_MODEL =
    (useShellOpenAIConfig ? shellOpenAIModel : undefined) ||
    (usePersistedOpenAIConfig ? persistedOpenAIModel : undefined) ||
    defaultOpenAIModel
  env.OPENAI_API_KEY = processEnv.OPENAI_API_KEY || persistedEnv.OPENAI_API_KEY
  delete env.CODEX_API_KEY
  delete env.CHATGPT_ACCOUNT_ID
  delete env.CODEX_ACCOUNT_ID
  return env
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

  // Saved /provider profiles should still win over provider-manager env that was
  // auto-applied during startup. Only explicit shell/flag provider selection
  // should bypass the persisted startup profile.
  const profileManagedEnv = processEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED === '1'
  if (hasExplicitProviderSelection(processEnv) && !profileManagedEnv) {
    return processEnv
  }

  if (!persisted) {
    return processEnv
  }

  const launchProcessEnv = profileManagedEnv
    ? (() => {
        const cleanedEnv = { ...processEnv }
        for (const key of PROFILE_ENV_KEYS) {
          delete cleanedEnv[key]
        }
        delete cleanedEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
        delete cleanedEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
        return cleanedEnv
      })()
    : processEnv

  return buildLaunchEnv({
    profile: persisted.profile,
    persisted,
    goal:
      options?.goal ??
      normalizeRecommendationGoal(processEnv.OPENCLAUDE_PROFILE_GOAL),
    processEnv: launchProcessEnv,
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
  for (const key of PROFILE_ENV_KEYS) {
    delete targetEnv[key]
  }

  Object.assign(targetEnv, nextEnv)
}
