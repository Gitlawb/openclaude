import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_OPENAI_BASE_URL,
  resolveProviderRequest,
} from '../services/api/providerConfig'
import {
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  type RecommendationGoal,
} from './providerRecommendation'
import { getOllamaChatBaseUrl } from './providerDiscovery'

export const PROFILE_FILE_NAME = '.openclaude-profile.json'

const PROFILE_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
] as const

const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY',
] as const

export type ProviderProfile = 'openai' | 'ollama' | 'atomic-chat'

export type ProfileEnv = {
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  OPENAI_API_KEY?: string
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
    value === 'atomic-chat'
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

  return `${sanitized.slice(0, 4)}...${sanitized.slice(-4)}`
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
    { OPENAI_API_KEY: processEnv.OPENAI_API_KEY },
  )
  const shellOpenAIBaseUrl = sanitizeProviderConfigValue(
    processEnv.OPENAI_BASE_URL,
    { OPENAI_API_KEY: key },
    { OPENAI_API_KEY: processEnv.OPENAI_API_KEY },
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
        { OPENAI_API_KEY: processEnv.OPENAI_API_KEY },
      ) ||
      (useShellOpenAIConfig ? shellOpenAIBaseUrl : undefined) ||
      DEFAULT_OPENAI_BASE_URL,
    OPENAI_MODEL:
      sanitizeProviderConfigValue(
        options.model,
        { OPENAI_API_KEY: key },
        { OPENAI_API_KEY: processEnv.OPENAI_API_KEY },
      ) ||
      (useShellOpenAIConfig ? shellOpenAIModel : undefined) ||
      defaultModel,
    OPENAI_API_KEY: key,
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

  return processEnv.CLAUDE_CODE_USE_OPENAI !== undefined
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
    { OPENAI_API_KEY: processEnv.OPENAI_API_KEY },
  )
  const shellOpenAIBaseUrl = sanitizeProviderConfigValue(
    processEnv.OPENAI_BASE_URL,
    { OPENAI_API_KEY: processEnv.OPENAI_API_KEY },
  )

  // Strip obsolete provider env vars that are no longer meaningful
  const {
    CODEX_API_KEY: _codexKey,
    CHATGPT_ACCOUNT_ID: _chatgptAcct,
    CLAUDE_CODE_USE_GEMINI: _geminiFlag,
    CLAUDE_CODE_USE_GITHUB: _githubFlag,
    CLAUDE_CODE_USE_BEDROCK: _bedrockFlag,
    CLAUDE_CODE_USE_VERTEX: _vertexFlag,
    GEMINI_API_KEY: _geminiKey,
    GEMINI_MODEL: _geminiModel,
    ...cleanProcessEnv
  } = processEnv

  const env: NodeJS.ProcessEnv = {
    ...cleanProcessEnv,
    CLAUDE_CODE_USE_OPENAI: '1',
  }

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
  return env
}

export async function buildStartupEnvFromProfile(options?: {
  persisted?: ProfileFile | null
  goal?: RecommendationGoal
  processEnv?: NodeJS.ProcessEnv
  getOllamaChatBaseUrl?: (baseUrl?: string) => string
  resolveOllamaDefaultModel?: (goal: RecommendationGoal) => Promise<string>
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
