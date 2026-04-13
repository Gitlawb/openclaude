import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  isCodexRefreshFailureCoolingDown,
  readCodexCredentials,
  type CodexCredentialBlob,
} from '../../utils/codexCredentials.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  asTrimmedString,
  parseChatgptAccountId,
} from './codexOAuthShared.js'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export const DEFAULT_MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'
/** Default GitHub Copilot API model when user selects copilot / github:copilot */
export const DEFAULT_GITHUB_MODELS_API_MODEL = 'gpt-4o'

const CODEX_ALIAS_MODELS: Record<
  string,
  {
    model: string
    reasoningEffort?: ReasoningEffort
  }
> = {
  codexplan: {
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  },
  'gpt-5.4': {
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  },
  'gpt-5.3-codex': {
    model: 'gpt-5.3-codex',
    reasoningEffort: 'high',
  },
  'gpt-5.3-codex-spark': {
    model: 'gpt-5.3-codex-spark',
  },
  codexspark: {
    model: 'gpt-5.3-codex-spark',
  },
  'gpt-5.2-codex': {
    model: 'gpt-5.2-codex',
    reasoningEffort: 'high',
  },
  'gpt-5.1-codex-max': {
    model: 'gpt-5.1-codex-max',
    reasoningEffort: 'high',
  },
  'gpt-5.1-codex-mini': {
    model: 'gpt-5.1-codex-mini',
  },
  'gpt-5.4-mini': {
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
  },
  'gpt-5.2': {
    model: 'gpt-5.2',
    reasoningEffort: 'medium',
  },
} as const

type CodexAlias = keyof typeof CODEX_ALIAS_MODELS
type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

const OPENAI_CODEX_SHORTCUT_ALIASES = new Set(['codexplan', 'codexspark'])

export type ProviderTransport = 'chat_completions' | 'codex_responses'

export type ResolvedProviderRequest = {
  transport: ProviderTransport
  requestedModel: string
  resolvedModel: string
  baseUrl: string
  reasoning?: {
    effort: ReasoningEffort
  }
}

export type ResolvedCodexCredentials = {
  apiKey: string
  accountId?: string
  authPath?: string
  source: 'env' | 'secure-storage' | 'auth.json' | 'none'
}

type ModelDescriptor = {
  raw: string
  baseModel: string
  reasoning?: {
    effort: ReasoningEffort
  }
}

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function isPrivateIpv4Address(hostname: string): boolean {
  const octets = hostname.split('.').map(part => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet))) {
    return false
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

function isPrivateIpv6Address(hostname: string): boolean {
  const firstHextet = hostname.split(':', 1)[0]
  if (!firstHextet) return false

  const prefix = Number.parseInt(firstHextet, 16)
  if (Number.isNaN(prefix)) return false

  return (prefix & 0xfe00) === 0xfc00 || (prefix & 0xffc0) === 0xfe80
}

// Reads an env-var-style string intended as a URL or path, rejecting both
// empty strings and the literal string "undefined" that Windows shells can
// write when a variable is unset-then-referenced without quotes (issue #336).
function asEnvUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined') return undefined
  return trimmed
}

function readNestedString(
  value: unknown,
  paths: string[][],
): string | undefined {
  for (const path of paths) {
    let current = value
    let valid = true
    for (const key of path) {
      if (!current || typeof current !== 'object' || !(key in current)) {
        valid = false
        break
      }
      current = (current as Record<string, unknown>)[key]
    }
    if (!valid) continue
    const stringValue = asTrimmedString(current)
    if (stringValue) return stringValue
  }
  return undefined
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') {
    return normalized
  }
  return undefined
}

function parseModelDescriptor(model: string): ModelDescriptor {
  const trimmed = model.trim()
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) {
    const alias = trimmed.toLowerCase() as CodexAlias
    const aliasConfig = CODEX_ALIAS_MODELS[alias]
    if (aliasConfig) {
      return {
        raw: trimmed,
        baseModel: aliasConfig.model,
        reasoning: aliasConfig.reasoningEffort
          ? { effort: aliasConfig.reasoningEffort }
          : undefined,
      }
    }
    return {
      raw: trimmed,
      baseModel: trimmed,
    }
  }

  const baseModel = trimmed.slice(0, queryIndex).trim()
  const params = new URLSearchParams(trimmed.slice(queryIndex + 1))
  const alias = baseModel.toLowerCase() as CodexAlias
  const aliasConfig = CODEX_ALIAS_MODELS[alias]
  const resolvedBaseModel = aliasConfig?.model ?? baseModel
  const reasoning =
    parseReasoningEffort(params.get('reasoning') ?? undefined) ??
    (aliasConfig?.reasoningEffort
      ? { effort: aliasConfig.reasoningEffort }
      : undefined)

  return {
    raw: trimmed,
    baseModel: resolvedBaseModel,
    reasoning: typeof reasoning === 'string' ? { effort: reasoning } : reasoning,
  }
}

export function isCodexAlias(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  const base = normalized.split('?', 1)[0] ?? normalized
  return base in CODEX_ALIAS_MODELS
}

function isOpenAICodexShortcutAlias(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  const base = normalized.split('?', 1)[0] ?? normalized
  return OPENAI_CODEX_SHORTCUT_ALIASES.has(base)
}

export function shouldUseCodexTransport(
  model: string,
  baseUrl: string | undefined,
): boolean {
  const explicitBaseUrl = asEnvUrl(baseUrl)
  return isCodexBaseUrl(explicitBaseUrl) || (!explicitBaseUrl && isCodexAlias(model))
}

function shouldUseGithubResponsesApi(model: string): boolean {
  const normalized = model.trim().toLowerCase()

  // Codex-branded models require /responses.
  if (normalized.includes('codex')) return true

  // GPT-5+ models use /responses, except gpt-5-mini.
  const match = /^gpt-(\d+)/.exec(normalized)
  if (!match) return false
  const major = Number(match[1])
  if (major < 5) return false
  if (normalized.startsWith('gpt-5-mini')) return false
  return true
}

export function isLocalProviderUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    let hostname = new URL(baseUrl).hostname.toLowerCase()

    // Strip IPv6 brackets added by the URL parser (e.g. "[::1]" -> "::1")
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1)
    }

    // Strip RFC6874 IPv6 zone identifiers (e.g. "fe80::1%25en0" -> "fe80::1")
    const zoneIdIndex = hostname.indexOf('%25')
    if (zoneIdIndex !== -1) {
      hostname = hostname.slice(0, zoneIdIndex)
    }

    if (LOCALHOST_HOSTNAMES.has(hostname) || hostname === '0.0.0.0') {
      return true
    }
    if (hostname.endsWith('.local')) {
      return true
    }

    const ipVersion = isIP(hostname)
    if (ipVersion === 4) {
      // Treat the full 127.0.0.0/8 loopback range as local
      const firstOctet = Number.parseInt(hostname.split('.', 1)[0] ?? '', 10)
      return firstOctet === 127 || isPrivateIpv4Address(hostname)
    }
    if (ipVersion === 6) {
      return isPrivateIpv6Address(hostname)
    }

    return false
  } catch {
    return false
  }
}

export function isCodexBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const parsed = new URL(baseUrl)
    return (
      parsed.hostname === 'chatgpt.com' &&
      parsed.pathname.replace(/\/+$/, '') === '/backend-api/codex'
    )
  } catch {
    return false
  }
}

/**
 * Normalize user model string for GitHub Copilot API inference.
 * Mirrors how Copilot resolves model IDs internally.
 */
export function normalizeGithubCopilotModel(requestedModel: string): string {
  const noQuery = requestedModel.split('?', 1)[0] ?? requestedModel
  const segment =
    noQuery.includes(':') ? noQuery.split(':', 2)[1]!.trim() : noQuery.trim()
  if (!segment || segment.toLowerCase() === 'copilot') {
    return DEFAULT_GITHUB_MODELS_API_MODEL
  }
  // Strip provider prefix if present (e.g., "openai/gpt-4o" -> "gpt-4o")
  const slashIndex = segment.indexOf('/')
  if (slashIndex !== -1) {
    return segment.slice(slashIndex + 1)
  }
  return segment
}

/**
 * Normalize user model string for GitHub Models API inference.
 * Only normalizes the default alias, preserves provider-qualified models.
 */
export function normalizeGithubModelsApiModel(requestedModel: string): string {
  const noQuery = requestedModel.split('?', 1)[0] ?? requestedModel
  const segment =
    noQuery.includes(':') ? noQuery.split(':', 2)[1]!.trim() : noQuery.trim()
  // Only normalize the default alias for GitHub Models
  if (!segment || segment.toLowerCase() === 'copilot') {
    return DEFAULT_GITHUB_MODELS_API_MODEL
  }
  // Preserve provider prefix for GitHub Models (e.g., "openai/gpt-4.1" stays as-is)
  return segment
}

export const GITHUB_COPILOT_BASE_URL = 'https://api.githubcopilot.com'
export const GITHUB_MODELS_BASE_URL = 'https://models.github.ai/inference'

export function getGithubEndpointType(
  baseUrl: string | undefined,
): 'copilot' | 'models' | 'custom' {
  if (!baseUrl) return 'copilot'
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    if (hostname === 'api.githubcopilot.com') {
      return 'copilot'
    }
    if (hostname === 'models.github.ai' || hostname.endsWith('.github.ai')) {
      return 'models'
    }
    return 'custom'
  } catch {
    return 'copilot'
  }
}

export function resolveProviderRequest(options?: {
  model?: string
  baseUrl?: string
  fallbackModel?: string
  reasoningEffortOverride?: ReasoningEffort
}): ResolvedProviderRequest {
  const isGithubMode = isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const isMistralMode = isEnvTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  const requestedModel =
    options?.model?.trim() ||
    (isMistralMode
      ? process.env.MISTRAL_MODEL?.trim()
      : process.env.OPENAI_MODEL?.trim()) ||
    options?.fallbackModel?.trim() ||
    (isGithubMode ? 'github:copilot' : 'gpt-4o')
  const descriptor = parseModelDescriptor(requestedModel)
  const explicitBaseUrl = asEnvUrl(options?.baseUrl)
  const envBaseUrlRaw =
    explicitBaseUrl ??
    asEnvUrl(
      isMistralMode
        ? (process.env.MISTRAL_BASE_URL ?? DEFAULT_MISTRAL_BASE_URL)
        : process.env.OPENAI_BASE_URL
    ) ??
    asEnvUrl(process.env.OPENAI_API_BASE)

  const isCodexModelForGithub = isGithubMode && isCodexAlias(requestedModel)
  const envBaseUrl =
    isCodexModelForGithub && envBaseUrlRaw && getGithubEndpointType(envBaseUrlRaw) === 'custom'
      ? undefined
      : envBaseUrlRaw

  const rawBaseUrl = explicitBaseUrl ?? envBaseUrl

  const shellModel = process.env.OPENAI_MODEL?.trim() ?? ''
  const envIsCodexShortcut = isOpenAICodexShortcutAlias(shellModel)
  const envResolvedCodexModel = envIsCodexShortcut
    ? parseModelDescriptor(shellModel).baseModel
    : null
  const requestedMatchesEnvCodexShortcut =
    Boolean(options?.model) &&
    Boolean(envResolvedCodexModel) &&
    descriptor.baseModel === envResolvedCodexModel
  const isCodexAliasModel =
    isOpenAICodexShortcutAlias(requestedModel) || requestedMatchesEnvCodexShortcut
  const hasUserSetBaseUrl = rawBaseUrl && rawBaseUrl !== DEFAULT_OPENAI_BASE_URL
  const finalBaseUrl =
    !isGithubMode && isCodexAliasModel && !hasUserSetBaseUrl
      ? DEFAULT_CODEX_BASE_URL
      : rawBaseUrl

  const githubEndpointType = isGithubMode
    ? getGithubEndpointType(rawBaseUrl)
    : 'custom'
  const isGithubCopilot = isGithubMode && githubEndpointType === 'copilot'
  const isGithubModels = isGithubMode && githubEndpointType === 'models'
  const isGithubCustom = isGithubMode && githubEndpointType === 'custom'

  const githubResolvedModel = isGithubMode
    ? normalizeGithubModelsApiModel(requestedModel)
    : requestedModel

  const transport: ProviderTransport =
    shouldUseCodexTransport(requestedModel, finalBaseUrl) ||
      (isGithubCopilot && shouldUseGithubResponsesApi(githubResolvedModel))
      ? 'codex_responses'
      : 'chat_completions'

  // For GitHub Copilot API, normalize to real model ID (e.g., "github:copilot" -> "gpt-4o")
  // For GitHub Models/custom endpoints:
  //   - Normalize default alias (github:copilot -> gpt-4o)
  //   - Preserve provider-qualified models (openai/gpt-4.1 stays as-is)
  const resolvedModel = isGithubCopilot
    ? normalizeGithubCopilotModel(descriptor.baseModel)
    : (isGithubModels || isGithubCustom
      ? normalizeGithubModelsApiModel(descriptor.baseModel)
      : descriptor.baseModel)

  const reasoning = options?.reasoningEffortOverride
    ? { effort: options.reasoningEffortOverride }
    : descriptor.reasoning

  return {
    transport,
    requestedModel,
    resolvedModel,
    baseUrl:
      (finalBaseUrl ??
        (isGithubCopilot && transport === 'codex_responses'
          ? GITHUB_COPILOT_BASE_URL
          : (isGithubMode
            ? GITHUB_COPILOT_BASE_URL
            : DEFAULT_OPENAI_BASE_URL))
      ).replace(/\/+$/, ''),
    reasoning,
  }
}

export function getAdditionalModelOptionsCacheScope(): string | null {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) {
    if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI) &&
        !isEnvTruthy(process.env.CLAUDE_CODE_USE_MISTRAL) &&
        !isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB) &&
        !isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) &&
        !isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) &&
        !isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) {
      return 'firstParty'
    }
    return null
  }

  const request = resolveProviderRequest()
  if (request.transport !== 'chat_completions') {
    return null
  }

  if (!isLocalProviderUrl(request.baseUrl)) {
    return null
  }

  return `openai:${request.baseUrl.toLowerCase()}`
}

export function resolveCodexAuthPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = asTrimmedString(env.CODEX_AUTH_JSON_PATH)
  if (explicit) return explicit

  const codexHome = asTrimmedString(env.CODEX_HOME)
  if (codexHome) return join(codexHome, 'auth.json')

  return join(homedir(), '.codex', 'auth.json')
}

function loadCodexAuthJson(
  authPath: string,
): Record<string, unknown> | undefined {
  if (!existsSync(authPath)) return undefined
  try {
    const raw = readFileSync(authPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function resolveCodexAuthJsonCredentials(options: {
  authJson: Record<string, unknown> | undefined
  authPath: string
  envAccountId?: string
  missingSource?: ResolvedCodexCredentials['source']
}): ResolvedCodexCredentials {
  const { authJson, authPath, envAccountId } = options

  if (!authJson) {
    return {
      apiKey: '',
      authPath,
      source: options.missingSource ?? 'none',
    }
  }

  const apiKey = readNestedString(authJson, [
    ['openai_api_key'],
    ['openaiApiKey'],
    ['access_token'],
    ['accessToken'],
    ['tokens', 'access_token'],
    ['tokens', 'accessToken'],
    ['auth', 'access_token'],
    ['auth', 'accessToken'],
    ['token', 'access_token'],
    ['token', 'accessToken'],
  ])
  // OIDC identity tokens can carry the ChatGPT account id, but they are not
  // valid bearer credentials for Codex API requests.
  const idToken = readNestedString(authJson, [
    ['id_token'],
    ['idToken'],
    ['tokens', 'id_token'],
    ['tokens', 'idToken'],
  ])
  const accountId =
    envAccountId ??
    readNestedString(authJson, [
      ['account_id'],
      ['accountId'],
      ['tokens', 'account_id'],
      ['tokens', 'accountId'],
      ['auth', 'account_id'],
      ['auth', 'accountId'],
    ]) ??
    parseChatgptAccountId(apiKey) ??
    parseChatgptAccountId(idToken)

  if (!apiKey) {
    return {
      apiKey: '',
      accountId,
      authPath,
      source: options.missingSource ?? 'none',
    }
  }

  return {
    apiKey,
    accountId,
    authPath,
    source: 'auth.json',
  }
}

export function resolveStoredCodexCredentials(options: {
  storedCredentials: Pick<
    CodexCredentialBlob,
    'apiKey' | 'accessToken' | 'idToken' | 'accountId'
  >
  envAccountId?: string
}): ResolvedCodexCredentials {
  const { storedCredentials, envAccountId } = options

  return {
    apiKey: storedCredentials.apiKey ?? storedCredentials.accessToken,
    accountId:
      envAccountId ??
      storedCredentials.accountId ??
      parseChatgptAccountId(storedCredentials.idToken) ??
      parseChatgptAccountId(storedCredentials.accessToken),
    source: 'secure-storage',
  }
}

function resolveEnvOrAuthJsonCodexCredentials(
  env: NodeJS.ProcessEnv,
  options?: {
    explicitAuthPathOnly?: boolean
  },
): ResolvedCodexCredentials {
  const envApiKey = asTrimmedString(env.CODEX_API_KEY)
  const envAccountId =
    asTrimmedString(env.CODEX_ACCOUNT_ID) ??
    asTrimmedString(env.CHATGPT_ACCOUNT_ID)

  if (envApiKey) {
    return {
      apiKey: envApiKey,
      accountId: envAccountId ?? parseChatgptAccountId(envApiKey),
      source: 'env',
    }
  }

  const explicitAuthPathConfigured = Boolean(
    asTrimmedString(env.CODEX_AUTH_JSON_PATH) ?? asTrimmedString(env.CODEX_HOME),
  )

  if (!explicitAuthPathConfigured && options?.explicitAuthPathOnly) {
    return {
      apiKey: '',
      accountId: envAccountId,
      source: 'none',
    }
  }

  const authPath = resolveCodexAuthPath(env)
  const authJson = loadCodexAuthJson(authPath)
  return resolveCodexAuthJsonCredentials({
    authJson,
    authPath,
    envAccountId,
  })
}

export function resolveRuntimeCodexCredentials(options?: {
  env?: NodeJS.ProcessEnv
  storedCredentials?: Pick<
    CodexCredentialBlob,
    'apiKey' | 'accessToken' | 'idToken' | 'accountId'
  >
}): ResolvedCodexCredentials {
  const env = options?.env ?? process.env
  const explicitCredentials = resolveEnvOrAuthJsonCodexCredentials(env, {
    explicitAuthPathOnly: true,
  })
  const explicitAuthPathConfigured = Boolean(
    asTrimmedString(env.CODEX_AUTH_JSON_PATH) ?? asTrimmedString(env.CODEX_HOME),
  )
  const hasStoredCredentialsOption = Boolean(
    options &&
      Object.prototype.hasOwnProperty.call(options, 'storedCredentials'),
  )

  if (
    explicitAuthPathConfigured ||
    explicitCredentials.source === 'env' ||
    explicitCredentials.source === 'auth.json'
  ) {
    return explicitCredentials
  }

  if (options?.storedCredentials?.accessToken) {
    return resolveStoredCodexCredentials({
      storedCredentials: options.storedCredentials,
      envAccountId:
        asTrimmedString(env.CODEX_ACCOUNT_ID) ??
        asTrimmedString(env.CHATGPT_ACCOUNT_ID),
    })
  }

  if (hasStoredCredentialsOption) {
    return resolveEnvOrAuthJsonCodexCredentials(env)
  }

  return resolveCodexApiCredentials(env)
}

export function resolveCodexApiCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCodexCredentials {
  const envAccountId =
    asTrimmedString(env.CODEX_ACCOUNT_ID) ??
    asTrimmedString(env.CHATGPT_ACCOUNT_ID)
  const envOrExplicitAuthJsonCredentials = resolveEnvOrAuthJsonCodexCredentials(
    env,
    {
      explicitAuthPathOnly: true,
    },
  )

  if (
    envOrExplicitAuthJsonCredentials.source === 'env' ||
    envOrExplicitAuthJsonCredentials.source === 'auth.json' ||
    envOrExplicitAuthJsonCredentials.authPath
  ) {
    return envOrExplicitAuthJsonCredentials
  }

  const storedCredentials = readCodexCredentials()
  if (storedCredentials?.accessToken) {
    const resolvedStoredCredentials = resolveStoredCodexCredentials({
      storedCredentials,
      envAccountId,
    })

    const shouldCheckDefaultAuthJson =
      !resolvedStoredCredentials.accountId ||
      isCodexRefreshFailureCoolingDown(storedCredentials)

    if (!shouldCheckDefaultAuthJson) {
      return resolvedStoredCredentials
    }

    const authPath = resolveCodexAuthPath(env)
    const authJson = loadCodexAuthJson(authPath)
    const resolvedAuthJsonCredentials = resolveCodexAuthJsonCredentials({
      authJson,
      authPath,
      envAccountId,
    })

    if (resolvedAuthJsonCredentials.apiKey) {
      return {
        ...resolvedAuthJsonCredentials,
        accountId:
          resolvedAuthJsonCredentials.accountId ??
          resolvedStoredCredentials.accountId,
      }
    }

    return resolvedStoredCredentials
  }

  return resolveEnvOrAuthJsonCodexCredentials(env)
}

export function getReasoningEffortForModel(model: string): ReasoningEffort | undefined {
  const normalized = model.trim().toLowerCase()
  const base = normalized.split('?', 1)[0] ?? normalized
  const alias = base as CodexAlias
  const aliasConfig = CODEX_ALIAS_MODELS[alias]
  return aliasConfig?.reasoningEffort
}

export function supportsCodexReasoningEffort(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  const base = normalized.split('?', 1)[0] ?? normalized

  if (base === 'gpt-5.3-codex-spark' || base === 'codexspark') {
    return false
  }

  if (getReasoningEffortForModel(base) !== undefined) {
    return true
  }

  return /^gpt-5(?:[.-]|$)/.test(base)
}
