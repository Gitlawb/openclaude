import {
  type APIProvider,
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  isClaudeAISubscriber,
  isManagedOAuthContext,
} from 'src/utils/auth.js'
import {
  getTransportKindForRoute,
  resolveActiveRouteIdFromEnv,
} from '../../integrations/routeMetadata.js'
import {
  type AnthropicAttributionAuth,
  type AnthropicAttributionPolicy,
  type AnthropicAttributionRoute,
  getAnthropicAttributionDiagnostic,
  resolveAnthropicAttributionAuth,
  resolveAnthropicAttributionPolicy,
} from '../../utils/anthropicAttribution.js'
import { logForDebugging } from '../../utils/debug.js'

export type ProviderOverride = { model: string; baseURL: string; apiKey: string }

function resolveAnthropicAttributionAuthTokenSource(
  authTokenSource: ReturnType<typeof getAuthTokenSource>['source'],
  managedOAuthContext: boolean,
): 'oauth' | 'api_key' | 'none' {
  if (
    managedOAuthContext &&
    (authTokenSource === 'ANTHROPIC_AUTH_TOKEN' ||
      authTokenSource === 'apiKeyHelper')
  ) {
    return 'none'
  }
  if (
    authTokenSource === 'ANTHROPIC_AUTH_TOKEN' ||
    authTokenSource === 'apiKeyHelper'
  ) {
    return 'api_key'
  }
  if (
    authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN' ||
    authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR' ||
    authTokenSource === 'CCR_OAUTH_TOKEN_FILE' ||
    authTokenSource === 'claude.ai'
  ) {
    return 'oauth'
  }
  return 'none'
}

export function resolveAnthropicAttributionAuthFromSources({
  apiKeySource,
  authTokenSource,
  isSubscriber,
  managedOAuthContext,
}: {
  apiKeySource: ReturnType<typeof getAnthropicApiKeyWithSource>['source']
  authTokenSource: ReturnType<typeof getAuthTokenSource>['source']
  isSubscriber: boolean
  managedOAuthContext: boolean
}): AnthropicAttributionAuth {
  // Match getAnthropicClient: managed remote and Desktop sessions send OAuth
  // and ignore inherited API-key settings, so those settings cannot win the
  // attribution credential precedence either.
  const apiKey = managedOAuthContext
    ? 'none'
    : apiKeySource === 'ANTHROPIC_API_KEY' || apiKeySource === 'apiKeyHelper'
      ? 'external'
      : apiKeySource === '/login managed key'
        ? 'managed'
        : 'none'
  const authToken = resolveAnthropicAttributionAuthTokenSource(
    authTokenSource,
    managedOAuthContext,
  )

  return resolveAnthropicAttributionAuth({
    apiKey,
    authToken,
    isSubscriber,
  })
}

function resolveCurrentAnthropicAttributionAuth(): AnthropicAttributionAuth {
  let apiKeySource: ReturnType<
    typeof getAnthropicApiKeyWithSource
  >['source'] = 'none'
  try {
    ;({ source: apiKeySource } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    }))
  } catch {
    // Missing credentials are an ambiguous state, not an error for policy.
  }

  let authTokenSource: ReturnType<typeof getAuthTokenSource>['source'] = 'none'
  try {
    ;({ source: authTokenSource } = getAuthTokenSource())
  } catch {
    return 'unknown'
  }

  const managedOAuthContext = isManagedOAuthContext()
  const hasOAuthToken =
    resolveAnthropicAttributionAuthTokenSource(
      authTokenSource,
      managedOAuthContext,
    ) === 'oauth'
  let isSubscriber = false
  if (hasOAuthToken) {
    try {
      isSubscriber = isClaudeAISubscriber()
    } catch {
      return 'unknown'
    }
  }

  return resolveAnthropicAttributionAuthFromSources({
    apiKeySource,
    authTokenSource,
    isSubscriber,
    managedOAuthContext,
  })
}

function resolveAnthropicAttributionRoute(
  providerOverride?: ProviderOverride,
): AnthropicAttributionRoute {
  if (providerOverride) return 'non_official'

  try {
    const routeId = resolveActiveRouteIdFromEnv(process.env)
    if (
      routeId === 'anthropic' &&
      getAPIProvider() === 'firstParty' &&
      isFirstPartyAnthropicBaseUrl()
    ) {
      return 'official_anthropic'
    }
    if (routeId && getTransportKindForRoute(routeId) !== null) {
      return 'non_official'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export function resolveCurrentAnthropicAttributionPolicy({
  attributionEnabled,
  providerOverride,
}: {
  attributionEnabled: boolean
  providerOverride?: ProviderOverride
}): AnthropicAttributionPolicy {
  const route = resolveAnthropicAttributionRoute(providerOverride)
  const policy = resolveAnthropicAttributionPolicy({
    route,
    auth:
      route === 'official_anthropic'
        ? resolveCurrentAnthropicAttributionAuth()
        : 'unknown',
    attributionEnabled,
  })
  const diagnostic = getAnthropicAttributionDiagnostic(policy)
  if (diagnostic) logForDebugging(diagnostic)
  return policy
}

export function shouldUseFirstPartyAnthropicAuthForProvider({
  providerOverride,
  apiProvider,
  isFirstPartyBaseUrl,
}: {
  providerOverride?: ProviderOverride
  apiProvider: APIProvider
  isFirstPartyBaseUrl: boolean
}): boolean {
  return !providerOverride && apiProvider === 'firstParty' && isFirstPartyBaseUrl
}

export function shouldUseFirstPartyAnthropicAuth(
  providerOverride?: ProviderOverride,
): boolean {
  return shouldUseFirstPartyAnthropicAuthForProvider({
    providerOverride,
    apiProvider: getAPIProvider(),
    isFirstPartyBaseUrl: isFirstPartyAnthropicBaseUrl(),
  })
}

export function shouldUseCustomAnthropicBearerAuth({
  providerOverride,
  apiProvider,
  isFirstPartyBaseUrl,
  authToken,
}: {
  providerOverride?: ProviderOverride
  apiProvider: APIProvider
  isFirstPartyBaseUrl: boolean
  authToken?: string
}): boolean {
  return Boolean(
    !providerOverride &&
      authToken?.trim() &&
      apiProvider === 'firstParty' &&
      !isFirstPartyBaseUrl,
  )
}
