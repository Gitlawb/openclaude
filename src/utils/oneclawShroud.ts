import { logForDebugging } from './debug.js'
import {
  isOneclawConfigured,
  loadOneclawConfig,
  getShroudBaseUrl,
  getOneclawAgentApiKey,
  getOneclawAgentId,
  getSecretPathForProvider,
} from './oneclaw.js'
import { isEnvTruthy } from './envUtils.js'

export interface ShroudRoutingResult {
  baseUrl: string
  headers: Record<string, string>
  providerHint: string
  useOpenAICompat?: boolean
  stripeModelName?: string
}

const PROVIDER_ENV_TO_SHROUD_PROVIDER: Record<string, string> = {
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  GEMINI_API_KEY: 'google',
  GOOGLE_API_KEY: 'google',
  MISTRAL_API_KEY: 'mistral',
}

export function isShroudEnabled(): boolean {
  if (isEnvTruthy(process.env.ONECLAW_SHROUD_DISABLED)) return false
  if (isEnvTruthy(process.env.ONECLAW_SHROUD_ENABLED)) return true

  const config = loadOneclawConfig()
  return config?.shroudEnabled === true
}

export function getShroudProvider(): string | null {
  if (process.env.ONECLAW_SHROUD_PROVIDER) {
    return process.env.ONECLAW_SHROUD_PROVIDER
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) return 'google'
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)) return 'mistral'

  if (process.env.OPENAI_API_KEY || isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) {
    return 'openai'
  }

  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'

  return 'openai'
}

export function buildShroudHeaders(options?: {
  model?: string
  provider?: string
}): Record<string, string> {
  const agentApiKey = getOneclawAgentApiKey()
  const agentId = getOneclawAgentId()

  if (!agentApiKey || !agentId) return {}

  const provider = options?.provider ?? getShroudProvider() ?? 'openai'

  const headers: Record<string, string> = {
    'X-Shroud-Agent-Key': `${agentId}:${agentApiKey}`,
    'X-Shroud-Provider': provider,
  }

  const config = loadOneclawConfig()
  const authMode = config?.authMode

  if (authMode === 'token-billing') {
    headers['X-Shroud-Billing'] = 'token'
  } else if (config?.vaultId) {
    const envKey = Object.entries(PROVIDER_ENV_TO_SHROUD_PROVIDER).find(
      ([_, p]) => p === provider,
    )?.[0]
    if (envKey) {
      const secretPath = getSecretPathForProvider(envKey)
      headers['X-Shroud-Api-Key'] = `vault://${config.vaultId}/${secretPath}`
    }
  }

  if (options?.model) {
    headers['X-Shroud-Model'] = authMode === 'token-billing'
      ? toStripeModelName(options.model)
      : options.model
  }

  return headers
}

/**
 * Convert Anthropic API model names to Stripe AI Gateway format.
 * Anthropic: claude-sonnet-4-5-20250929 → Stripe: claude-sonnet-4.5
 * Anthropic: claude-opus-4-6            → Stripe: claude-opus-4.6
 */
function toStripeModelName(model: string): string {
  let name = model.replace(/-\d{8}$/, '')
  name = name.replace(/(\d+)-(\d+)$/, '$1.$2')
  return name
}

export function applyShroudRouting(options?: {
  model?: string
  provider?: string
}): ShroudRoutingResult | null {
  if (!isShroudEnabled()) return null
  if (!isOneclawConfigured()) return null

  const config = loadOneclawConfig()
  const provider = options?.provider ?? getShroudProvider() ?? 'openai'
  const headers = buildShroudHeaders({ ...options, provider })

  if (!headers['X-Shroud-Agent-Key']) return null

  const baseUrl = getShroudBaseUrl()
  const isTokenBilling = config?.authMode === 'token-billing'

  logForDebugging(`[Shroud] routing to ${baseUrl} via provider=${provider} billing=${isTokenBilling}`)

  return {
    baseUrl: `${baseUrl}/v1`,
    headers,
    providerHint: provider,
    useOpenAICompat: isTokenBilling,
    stripeModelName: isTokenBilling && options?.model ? toStripeModelName(options.model) : undefined,
  }
}
