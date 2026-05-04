import { resolve } from 'node:path'
import '../integrations/index.js'
import {
  ensureIntegrationsLoaded,
  getAllGateways,
  getAllVendors,
} from '../integrations/index.js'
import type {
  GatewayDescriptor,
  ValidationMetadata,
  VendorDescriptor,
} from '../integrations/descriptors.js'
import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  getRouteDescriptor,
  getRouteDefaultModel,
  resolveActiveRouteIdFromEnv,
  resolveRouteIdFromBaseUrl,
} from '../integrations/routeMetadata.js'
import {
  getGithubEndpointType,
  isLikelyOllamaEndpoint,
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
  shouldUseCodexTransport,
} from '../services/api/providerConfig.js'
import { getGlobalClaudeFile } from './env.js'
import { isBareMode } from './envUtils.js'
import {
  type GeminiResolvedCredential,
  resolveGeminiCredential,
} from './geminiAuth.js'
import { PROFILE_FILE_NAME } from './providerProfile.js'
import {
  redactSecretValueForDisplay,
  type SecretValueSource,
} from './providerSecrets.js'

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

type GithubTokenStatus = 'valid' | 'expired' | 'invalid_format'

type ValidationTarget =
  | { kind: 'vendor'; descriptor: VendorDescriptor }
  | { kind: 'gateway'; descriptor: GatewayDescriptor }

const GITHUB_PAT_PREFIXES = ['ghp_', 'gho_', 'ghs_', 'ghr_', 'github_pat_']

function checkGithubTokenStatus(
  token: string,
  endpointType: 'copilot' | 'models' | 'custom' = 'copilot',
): GithubTokenStatus {
  // PATs work with GitHub Models but not with Copilot API
  if (GITHUB_PAT_PREFIXES.some(prefix => token.startsWith(prefix))) {
    if (endpointType === 'copilot') {
      return 'expired'
    }
    return 'valid'
  }

  const expMatch = token.match(/exp=(\d+)/)
  if (expMatch) {
    const expSeconds = Number(expMatch[1])
    if (!Number.isNaN(expSeconds)) {
      return Date.now() >= expSeconds * 1000 ? 'expired' : 'valid'
    }
  }

  const parts = token.split('.')
  const looksLikeJwt =
    parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
  if (looksLikeJwt) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
      const json = Buffer.from(padded, 'base64').toString('utf8')
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && parsed.exp) {
        return Date.now() >= (parsed.exp as number) * 1000 ? 'expired' : 'valid'
      }
    } catch {
      return 'invalid_format'
    }
  }

  // Keep compatibility with opaque token formats that do not expose expiry.
  return 'valid'
}

function getOpenAIMissingKeyMessage(): string {
  const globalConfigPath = getGlobalClaudeFile()
  const profilePath = resolve(process.cwd(), PROFILE_FILE_NAME)

  return [
    'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
    `To recover, run /provider and switch provider, or set CLAUDE_CODE_USE_OPENAI=0 in your shell environment.`,
    `Saved startup settings can come from ${globalConfigPath} or ${profilePath}.`,
  ].join('\n')
}

function hasNonEmptyEnvValue(
  env: NodeJS.ProcessEnv,
  envVar: string,
): boolean {
  return typeof env[envVar] === 'string' && env[envVar]!.trim() !== ''
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) {
    return undefined
  }

  const trimmed = baseUrl.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed.replace(/\/+$/, '').toLowerCase()
}

function baseUrlMatchesDescriptor(
  baseUrl: string | undefined,
  descriptorBaseUrl: string | undefined,
): boolean {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedDescriptorBaseUrl = normalizeBaseUrl(descriptorBaseUrl)

  return Boolean(
    normalizedBaseUrl &&
      normalizedDescriptorBaseUrl &&
      normalizedBaseUrl === normalizedDescriptorBaseUrl,
  )
}

function getNormalizedBaseUrlHost(
  baseUrl: string | undefined,
): string | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (!normalizedBaseUrl) {
    return undefined
  }

  try {
    return new URL(normalizedBaseUrl).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function getValidationTargets(): ValidationTarget[] {
  ensureIntegrationsLoaded()

  return [
    ...getAllVendors()
      .filter((descriptor): descriptor is VendorDescriptor => Boolean(descriptor.validation))
      .map(descriptor => ({ kind: 'vendor', descriptor }) as const),
    ...getAllGateways()
      .filter((descriptor): descriptor is GatewayDescriptor => Boolean(descriptor.validation))
      .map(descriptor => ({ kind: 'gateway', descriptor }) as const),
  ]
}

function getValidationRouting(target: ValidationTarget) {
  return target.descriptor.validation?.routing
}

function getValidationTargetBaseUrl(
  target: ValidationTarget,
): string | undefined {
  return target.descriptor.defaultBaseUrl
}

function getRuntimeValidationTarget(
  env: NodeJS.ProcessEnv,
): ValidationTarget | undefined {
  const useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
  const validationTargets = getValidationTargets()

  const enabledTarget = validationTargets.find(target => {
    const routing = getValidationRouting(target)
    if (!routing?.enablementEnvVar || !isEnvTruthy(env[routing.enablementEnvVar])) {
      return false
    }

    if (useOpenAI && routing.skipWhenUseOpenAI) {
      return false
    }

    return true
  })

  if (enabledTarget) {
    return enabledTarget
  }

  if (!useOpenAI) {
    return undefined
  }

  const request = resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
    fallbackModel: getRouteDefaultModel('openai'),
  })

  const baseUrlMatchedTarget = validationTargets.find(target => {
    const routing = getValidationRouting(target)
    if (!routing?.matchDefaultBaseUrl && !routing?.matchBaseUrlHosts?.length) {
      return false
    }

    if (baseUrlMatchesDescriptor(
      request.baseUrl,
      getValidationTargetBaseUrl(target),
    )) {
      return true
    }

    const requestHost = getNormalizedBaseUrlHost(request.baseUrl)
    if (!requestHost) {
      return false
    }

    return (
      routing.matchBaseUrlHosts?.some(
        host => requestHost === host.toLowerCase(),
      ) ?? false
    )
  })

  if (baseUrlMatchedTarget) {
    return baseUrlMatchedTarget
  }

  return validationTargets.find(
    target => getValidationRouting(target)?.fallbackWhenUseOpenAI,
  )
}

function getCredentialEnvValidationError(
  validation: Extract<ValidationMetadata, { kind: 'credential-env' }>,
  env: NodeJS.ProcessEnv,
  request?: ReturnType<typeof resolveProviderRequest>,
): string | null {
  for (const invalidValue of validation.invalidCredentialValues ?? []) {
    if (env[invalidValue.envVar]?.trim() === invalidValue.value) {
      return invalidValue.message
    }
  }

  if (
    validation.allowLocalBaseUrlWithoutCredential &&
    request &&
    (isLocalProviderUrl(request.baseUrl) ||
      isLikelyOllamaEndpoint(request.baseUrl))
  ) {
    return null
  }

  if (
    validation.credentialEnvVars.some(envVar => hasNonEmptyEnvValue(env, envVar))
  ) {
    return null
  }

  return validation.missingCredentialMessage ?? null
}

async function getDescriptorValidationError(
  target: ValidationTarget,
  env: NodeJS.ProcessEnv,
  options: {
    request?: ReturnType<typeof resolveProviderRequest>
    resolveGeminiCredential?: (
      env: NodeJS.ProcessEnv,
    ) => Promise<GeminiResolvedCredential>
  },
): Promise<string | null> {
  const validation = target.descriptor.validation
  if (!validation) {
    return null
  }

  switch (validation.kind) {
    case 'credential-env':
      return getCredentialEnvValidationError(validation, env, options.request)

    case 'gemini-credential': {
      const geminiCredential = await (
        options.resolveGeminiCredential ?? resolveGeminiCredential
      )(env)
      return geminiCredential.kind === 'none'
        ? validation.missingCredentialMessage
        : null
    }

    case 'github-token': {
      const token = (env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()) ?? ''
      if (!token) {
        return validation.missingCredentialMessage
      }

      const endpointType = getGithubEndpointType(env.OPENAI_BASE_URL)
      const status = checkGithubTokenStatus(token, endpointType)
      if (status === 'expired') {
        return validation.expiredCredentialMessage
      }
      if (status === 'invalid_format') {
        return validation.invalidCredentialMessage
      }

      return null
    }
  }
}

function getGenericRouteCredentialValidationError(
  env: NodeJS.ProcessEnv,
  request: ReturnType<typeof resolveProviderRequest>,
): { applicable: boolean; error: string | null } {
  const routeId =
    resolveRouteIdFromBaseUrl(request.baseUrl) ??
    resolveActiveRouteIdFromEnv(env)
  if (!routeId || routeId === 'anthropic' || routeId === 'custom') {
    return { applicable: false, error: null }
  }

  const descriptor = getRouteDescriptor(routeId)
  if (
    !descriptor ||
    descriptor.validation ||
    !descriptor.setup.requiresAuth ||
    !['openai-compatible', 'local'].includes(descriptor.transportConfig.kind)
  ) {
    return { applicable: false, error: null }
  }

  if (
    descriptor.setup.authMode !== 'api-key' &&
    descriptor.setup.authMode !== 'token'
  ) {
    return { applicable: false, error: null }
  }

  if (
    descriptor.setup.authMode === 'api-key' &&
    isLocalProviderUrl(request.baseUrl)
  ) {
    return { applicable: true, error: null }
  }

  if (getRouteCredentialValue(routeId, env)) {
    return { applicable: true, error: null }
  }

  const credentialEnvVars = getRouteCredentialEnvVars(routeId)
  if (credentialEnvVars.length === 0) {
    return { applicable: false, error: null }
  }

  return {
    applicable: true,
    error: `${descriptor.label} auth is required. Set ${credentialEnvVars.join(' or ')}.`,
  }
}

export async function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    resolveGeminiCredential?: (
      env: NodeJS.ProcessEnv,
    ) => Promise<GeminiResolvedCredential>
  },
): Promise<string | null> {
  const secretSource: SecretValueSource = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    CODEX_API_KEY: env.CODEX_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY,
    MISTRAL_API_KEY: env.MISTRAL_API_KEY,
    BNKR_API_KEY: env.BNKR_API_KEY,
  }
  const useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
  const validationTarget = getRuntimeValidationTarget(env)

  if (!useOpenAI && !validationTarget) {
    return null
  }

  const request = resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
    fallbackModel: getRouteDefaultModel('openai'),
  })
  const genericRouteValidation = getGenericRouteCredentialValidationError(
    env,
    request,
  )

  // Codex auth depends on transport resolution plus local auth/account state,
  // so it intentionally stays procedural instead of moving into descriptors.
  const explicitBaseUrl =
    env.OPENAI_BASE_URL?.trim() || env.OPENAI_API_BASE?.trim()
  const hasExplicitCodexIntent =
    (env.OPENAI_MODEL?.trim()
      ? shouldUseCodexTransport(env.OPENAI_MODEL, explicitBaseUrl)
      : false) || Boolean(explicitBaseUrl && shouldUseCodexTransport('', explicitBaseUrl))

  if (hasExplicitCodexIntent) {
    const credentials = resolveCodexApiCredentials(env)
    if (!credentials.apiKey) {
      const oauthHint = isBareMode() ? '' : ', choose Codex OAuth in /provider'
      const authHint = credentials.authPath
        ? `${oauthHint} or put auth.json at ${credentials.authPath}`
        : oauthHint
      const safeModel =
        redactSecretValueForDisplay(env.OPENAI_MODEL, secretSource) ??
        redactSecretValueForDisplay(request.requestedModel, secretSource) ??
        'the requested model'
      return `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`
    }
    if (!credentials.accountId) {
      return 'Codex auth is missing chatgpt_account_id. Re-login with Codex OAuth, Codex CLI, or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.'
    }
    return null
  }

  const activeRouteId = resolveActiveRouteIdFromEnv(env)
  const shouldPreferGenericRouteValidation =
    validationTarget?.kind === 'vendor' &&
    validationTarget.descriptor.id === 'openai' &&
    genericRouteValidation.applicable &&
    activeRouteId !== 'openai' &&
    activeRouteId !== 'custom'

  if (validationTarget) {
    if (!shouldPreferGenericRouteValidation) {
      const descriptorValidationError = await getDescriptorValidationError(
        validationTarget,
        env,
        {
          request,
          resolveGeminiCredential: options?.resolveGeminiCredential,
        },
      )

      if (descriptorValidationError) {
        if (
          validationTarget.kind === 'vendor' &&
          validationTarget.descriptor.id === 'openai' &&
          !env.OPENAI_API_KEY &&
          !isLocalProviderUrl(request.baseUrl) &&
          !isLikelyOllamaEndpoint(request.baseUrl)
        ) {
          return getOpenAIMissingKeyMessage()
        }

        return descriptorValidationError
      }

      return null
    }
  }

  if (genericRouteValidation.applicable) {
    return genericRouteValidation.error
  }

  if (
    !env.OPENAI_API_KEY &&
    !isLocalProviderUrl(request.baseUrl) &&
    !isLikelyOllamaEndpoint(request.baseUrl)
  ) {
    return getOpenAIMissingKeyMessage()
  }

  return null
}

export async function validateProviderEnvOrExit(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (error) {
    console.error(error)
    process.exit(1)
  }
}

export function shouldExitForStartupProviderValidationError(options: {
  args?: string[]
  stdoutIsTTY?: boolean
} = {}): boolean {
  const args = options.args ?? process.argv.slice(2)
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY

  if (!stdoutIsTTY) {
    return true
  }

  return (
    args.includes('-p') ||
    args.includes('--print') ||
    args.includes('--init-only') ||
    args.some(arg => arg.startsWith('--sdk-url'))
  )
}

export async function validateProviderEnvForStartupOrExit(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    args?: string[]
    stdoutIsTTY?: boolean
  },
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (!error) {
    return
  }

  if (shouldExitForStartupProviderValidationError(options)) {
    console.error(error)
    process.exit(1)
  }

  console.error(
    `Warning: provider configuration is incomplete.\n${error}\nOpenClaude will continue starting so you can run /provider and repair the saved provider settings.`,
  )
}
