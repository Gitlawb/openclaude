/**
 * --provider CLI flag support.
 *
 * Maps the user-friendly provider name to the environment variables
 * that the rest of the codebase uses for provider detection.
 *
 * Usage:
 *   openclaude --provider openai --model gpt-4o
 *   openclaude --provider gemini --model gemini-2.0-flash
 *   openclaude --provider mistral --model ministral-3b-latest
 *   openclaude --provider ollama --model llama3.2
 *   openclaude --provider anthropic   (default, no-op)
 */

import '../integrations/index.js'
import {
  ensureIntegrationsLoaded,
  getAllGateways,
  getAllVendors,
  getGateway,
  getVendor,
  resolveProfileRoute,
  resolveRouteIdFromBaseUrl,
} from '../integrations/index.js'
import { PRESET_VENDOR_MAP } from '../integrations/compatibility.js'

const PREFERRED_PROVIDER_ORDER = [
  'anthropic',
  'bankr',
  'zai',
  'xai',
  'xiaomi-mimo',
  'openai',
  'gemini',
  'mistral',
  'github',
  'bedrock',
  'vertex',
  'ollama',
  'nvidia-nim',
  'minimax',
  'venice',
  'atlas-cloud',
  'nearai',
  'fireworks',
] as const

function buildValidProviders(): string[] {
  ensureIntegrationsLoaded()

  const discovered = new Set<string>([
    ...PRESET_VENDOR_MAP.map(mapping => mapping.preset),
    ...getAllVendors().map(vendor => vendor.id),
    ...getAllGateways().map(gateway => gateway.id),
  ])

  const preferred = PREFERRED_PROVIDER_ORDER.filter(provider =>
    discovered.has(provider),
  )
  const remainder = Array.from(discovered)
    .filter(provider => !preferred.includes(provider as (typeof PREFERRED_PROVIDER_ORDER)[number]))
    .sort()

  return [...preferred, ...remainder]
}

export const VALID_PROVIDERS = buildValidProviders()

export type ProviderFlagName = string

let rememberedProviderFlag:
  | {
      provider: string
      model?: string
    }
  | null = null

/**
 * Extract the value of --provider from argv.
 * Returns null if the flag is absent or has no value.
 */
export function parseProviderFlag(args: string[]): string | null {
  const idx = args.indexOf('--provider')
  if (idx === -1) return null
  const value = args[idx + 1]
  if (!value || value.startsWith('--')) return null
  return value
}

/**
 * Parse and apply --provider from argv in one step.
 * Returns undefined when the flag is absent.
 */
export function applyProviderFlagFromArgs(
  args: string[],
  options?: {
    rememberForSettingsEnv?: boolean
  },
): { error?: string } | undefined {
  const provider = parseProviderFlag(args)
  if (!provider) return undefined
  const result = applyProviderFlag(provider, args)
  if (!result.error && options?.rememberForSettingsEnv) {
    const model = parseModelFlag(args)
    rememberedProviderFlag = model ? { provider, model } : { provider }
  }
  return result
}

export function reapplyRememberedProviderFlag():
  | { error?: string }
  | undefined {
  if (!rememberedProviderFlag) return undefined

  const args = ['--provider', rememberedProviderFlag.provider]
  if (rememberedProviderFlag.model) {
    args.push('--model', rememberedProviderFlag.model)
  }

  return applyProviderFlag(rememberedProviderFlag.provider, args)
}

export function clearRememberedProviderFlagForTests(): void {
  rememberedProviderFlag = null
}

/**
 * Extract the value of --model from argv.
 * Returns null if absent.
 */
export function parseModelFlag(args: string[]): string | null {
  const idx = args.indexOf('--model')
  if (idx === -1) return null
  const value = args[idx + 1]
  if (!value || value.startsWith('--')) return null
  return value
}

function getRouteDefaults(provider: string): {
  defaultBaseUrl?: string
  defaultModel?: string
} {
  ensureIntegrationsLoaded()

  const route = resolveProfileRoute(provider)
  const vendor =
    getVendor(route.vendorId) ??
    (route.routeId !== route.vendorId ? getVendor(route.routeId) : undefined)
  const gateway =
    (route.gatewayId ? getGateway(route.gatewayId) : undefined) ??
    getGateway(route.routeId)

  const defaultModel = gateway?.defaultModel ?? vendor?.defaultModel

  return {
    defaultBaseUrl: gateway?.defaultBaseUrl ?? vendor?.defaultBaseUrl,
    defaultModel,
  }
}

function normalizeBaseUrlEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed !== 'undefined' ? trimmed : undefined
}

function getConfiguredOpenAIBaseUrl(): string | undefined {
  const baseUrl = normalizeBaseUrlEnv(process.env.OPENAI_BASE_URL)
  if (baseUrl) {
    return baseUrl
  }

  return normalizeBaseUrlEnv(process.env.OPENAI_API_BASE)
}

function shouldReplaceStaleKnownBaseUrl(provider: string): boolean {
  const currentRouteId = resolveRouteIdFromBaseUrl(
    getConfiguredOpenAIBaseUrl(),
  )
  if (!currentRouteId) {
    return false
  }

  const targetRouteId = resolveProfileRoute(provider).routeId
  return (
    targetRouteId !== 'openai' &&
    targetRouteId !== 'custom' &&
    targetRouteId !== 'unknown-fallback' &&
    currentRouteId !== targetRouteId
  )
}

function applyOpenAIBaseUrlDefault(provider: string, baseUrl?: string): void {
  const normalizedBaseUrl = baseUrl?.trim()
  if (!normalizedBaseUrl) {
    return
  }

  if (
    !getConfiguredOpenAIBaseUrl() ||
    shouldReplaceStaleKnownBaseUrl(provider)
  ) {
    process.env.OPENAI_BASE_URL = normalizedBaseUrl
  }
}

/**
 * Apply --model (without --provider) to process.env for the current process only.
 *
 * Issue #808: `openclaude --model <name>` should work standalone so users can
 * override the session model without reconfiguring a profile or polluting the
 * shell with OPENAI_MODEL=... Must run before the startup banner so the
 * displayed model matches the flag, and before resolution paths that read the
 * provider-specific *_MODEL env var directly.
 *
 * Routes the value to the env var matching the already-active provider
 * (detected from CLAUDE_CODE_USE_* vars set by saved profile or env). Returns
 * undefined when --model is absent or --provider is present (that path is
 * handled by applyProviderFlagFromArgs).
 */
export function applyModelFlagFromArgs(args: string[]): void {
  if (args.includes('--provider')) return
  const model = parseModelFlag(args)
  if (!model) return

  const useGemini =
    process.env.CLAUDE_CODE_USE_GEMINI === '1' ||
    process.env.CLAUDE_CODE_USE_GEMINI === 'true'
  const useMistral =
    process.env.CLAUDE_CODE_USE_MISTRAL === '1' ||
    process.env.CLAUDE_CODE_USE_MISTRAL === 'true'
  const useOpenAI =
    process.env.CLAUDE_CODE_USE_OPENAI === '1' ||
    process.env.CLAUDE_CODE_USE_OPENAI === 'true'
  const useGithub =
    process.env.CLAUDE_CODE_USE_GITHUB === '1' ||
    process.env.CLAUDE_CODE_USE_GITHUB === 'true'

  if (useGemini) {
    process.env.GEMINI_MODEL = model
  } else if (useMistral) {
    process.env.MISTRAL_MODEL = model
  } else if (useOpenAI || useGithub) {
    process.env.OPENAI_MODEL = model
  } else {
    process.env.ANTHROPIC_MODEL = model
  }
}

/**
 * Apply a provider name to process.env.
 * Sets the required CLAUDE_CODE_USE_* flag and any provider-specific
 * defaults (Ollama base URL, model routing). Preserves explicit custom
 * endpoint env vars for descriptor-backed defaults, while replacing stale
 * known provider endpoints when the user explicitly chooses a different
 * descriptor-backed provider.
 *
 * Returns { error } if the provider name is not recognized.
 */
export function applyProviderFlag(
  provider: string,
  args: string[],
): { error?: string } {
  if (!VALID_PROVIDERS.includes(provider)) {
    return {
      error: `Unknown provider "${provider}". Valid providers: ${VALID_PROVIDERS.join(', ')}`,
    }
  }

  const opengatewayApiKey = process.env.OPENGATEWAY_API_KEY?.trim()
  const copiedOpenAIKeyProvider =
    process.env.OPENAI_API_KEY !== undefined &&
    process.env.OPENAI_API_KEY === process.env.NVIDIA_API_KEY &&
    process.env.NVIDIA_NIM === '1'
      ? 'nvidia-nim'
      : process.env.OPENAI_API_KEY !== undefined &&
          process.env.OPENAI_API_KEY === process.env.BNKR_API_KEY
        ? 'bankr'
        : process.env.OPENAI_API_KEY !== undefined &&
            process.env.OPENAI_API_KEY === process.env.XAI_API_KEY
          ? 'xai'
          : process.env.OPENAI_API_KEY !== undefined &&
              process.env.OPENAI_API_KEY === process.env.MIMO_API_KEY
            ? 'xiaomi-mimo'
            : process.env.OPENAI_API_KEY !== undefined &&
                process.env.OPENAI_API_KEY === process.env.VENICE_API_KEY
              ? 'venice'
              : process.env.OPENAI_API_KEY !== undefined &&
                  process.env.OPENAI_API_KEY === process.env.MINIMAX_API_KEY
                ? 'minimax'
                  : process.env.OPENAI_API_KEY !== undefined &&
                      process.env.OPENAI_API_KEY === process.env.ATLAS_CLOUD_API_KEY
                    ? 'atlas-cloud'
                    : process.env.OPENAI_API_KEY !== undefined &&
                        process.env.OPENAI_API_KEY === process.env.NEARAI_API_KEY
                      ? 'nearai'
                      : process.env.OPENAI_API_KEY !== undefined &&
                        process.env.OPENAI_API_KEY === process.env.FIREWORKS_API_KEY
                      ? 'fireworks'
                      : process.env.OPENAI_API_KEY !== undefined &&
                      opengatewayApiKey !== undefined &&
                      opengatewayApiKey.length > 0 &&
                      process.env.OPENAI_API_KEY === opengatewayApiKey
                    ? 'gitlawb-opengateway'
                    : null

  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.NVIDIA_NIM
  if (copiedOpenAIKeyProvider && provider !== copiedOpenAIKeyProvider) {
    delete process.env.OPENAI_API_KEY
  }

  const model = parseModelFlag(args)
  const { defaultBaseUrl, defaultModel } = getRouteDefaults(provider)

  switch (provider) {
    case 'anthropic':
      // Default — no env vars needed
      break

    case 'openai':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      if (model) process.env.OPENAI_MODEL = model
      break

    case 'gemini':
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      if (model) process.env.GEMINI_MODEL = model
      break

    case 'mistral':
      process.env.CLAUDE_CODE_USE_MISTRAL = '1'
      if (model) process.env.MISTRAL_MODEL = model
      break

    case 'github':
      process.env.CLAUDE_CODE_USE_GITHUB = '1'
      if (model) process.env.OPENAI_MODEL = model
      break

    case 'bedrock':
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      break

    case 'vertex':
      process.env.CLAUDE_CODE_USE_VERTEX = '1'
      break

    case 'ollama':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= defaultBaseUrl ?? 'http://localhost:11434/v1'
      if (!process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = 'ollama'
      }
      if (model) process.env.OPENAI_MODEL = model
      break

    case 'nvidia-nim':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= defaultBaseUrl ?? 'https://integrate.api.nvidia.com/v1'
      process.env.NVIDIA_NIM = '1'
      if (process.env.NVIDIA_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.NVIDIA_API_KEY
      }
      process.env.OPENAI_MODEL ??= 'nvidia/llama-3.1-nemotron-70b-instruct'
      if (model) process.env.OPENAI_MODEL = model
      break

    case 'bankr':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= defaultBaseUrl ?? 'https://llm.bankr.bot/v1'
      process.env.OPENAI_MODEL ??= 'claude-opus-4.6'
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.BNKR_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.BNKR_API_KEY
      }
      break

    case 'minimax':
      delete process.env.OPENAI_BASE_URL
      delete process.env.OPENAI_API_BASE
      delete process.env.OPENAI_MODEL
      delete process.env.OPENAI_API_FORMAT
      delete process.env.OPENAI_AUTH_HEADER
      delete process.env.OPENAI_AUTH_SCHEME
      delete process.env.OPENAI_AUTH_HEADER_VALUE
      process.env.ANTHROPIC_BASE_URL = defaultBaseUrl ?? 'https://api.minimax.io/anthropic'
      process.env.ANTHROPIC_MODEL = defaultModel ?? 'MiniMax-M3'
      if (model) process.env.ANTHROPIC_MODEL = model
      if (process.env.MINIMAX_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = process.env.MINIMAX_API_KEY
      }
      if (copiedOpenAIKeyProvider === 'minimax') {
        delete process.env.OPENAI_API_KEY
      }
      break

    case 'gitlawb-opengateway':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      if (process.env.OPENGATEWAY_BASE_URL?.trim()) {
        process.env.OPENAI_BASE_URL = process.env.OPENGATEWAY_BASE_URL.trim()
      } else {
        applyOpenAIBaseUrlDefault(
          provider,
          defaultBaseUrl ?? 'https://opengateway.gitlawb.com/v1',
        )
      }
      process.env.OPENAI_MODEL ??= defaultModel ?? 'mimo-v2.5-pro'
      if (model) process.env.OPENAI_MODEL = model
      if (opengatewayApiKey) {
        process.env.OPENAI_API_KEY = opengatewayApiKey
      }
      break

    case 'nearai':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      applyOpenAIBaseUrlDefault(provider, defaultBaseUrl)
      if (defaultModel) {
        process.env.OPENAI_MODEL ??= defaultModel
      }
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.NEARAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.NEARAI_API_KEY
      } else {
        delete process.env.OPENAI_API_KEY
      }
      break

    case 'xai':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= 'https://api.x.ai/v1'
      process.env.OPENAI_MODEL ??= defaultModel ?? 'grok-4.3'
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.XAI_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.XAI_API_KEY
      }
      break

    case 'xiaomi-mimo':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= defaultBaseUrl ?? 'https://api.xiaomimimo.com/v1'
      process.env.OPENAI_MODEL ??= defaultModel ?? 'mimo-v2.5-pro'
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.MIMO_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.MIMO_API_KEY
      }
      break

    case 'xiaomi-mimo-token':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      applyOpenAIBaseUrlDefault(
        provider,
        defaultBaseUrl ?? 'https://token-plan-sgp.xiaomimimo.com/v1',
      )
      process.env.OPENAI_MODEL ??= defaultModel ?? 'mimo-v2.5-pro'
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.MIMO_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.MIMO_API_KEY
      }
      break

    case 'venice':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= defaultBaseUrl ?? 'https://api.venice.ai/api/v1'
      process.env.OPENAI_MODEL ??= defaultModel ?? 'venice-uncensored'
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.VENICE_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.VENICE_API_KEY
      }
      break

    case 'atlas-cloud':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      applyOpenAIBaseUrlDefault(
        provider,
        defaultBaseUrl ?? 'https://api.atlascloud.ai/v1',
      )
      process.env.OPENAI_MODEL ??= defaultModel ?? 'deepseek-ai/deepseek-v4-pro'
      if (model) process.env.OPENAI_MODEL = model
      // The dedicated key always wins so a lingering OPENAI_API_KEY from
      // another provider is never sent to Atlas Cloud; without it the
      // generic key is cleared for the same reason and validation reports
      // the missing ATLAS_CLOUD_API_KEY instead.
      if (process.env.ATLAS_CLOUD_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.ATLAS_CLOUD_API_KEY
      } else {
        delete process.env.OPENAI_API_KEY
      }
      break

    case 'fireworks':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      applyOpenAIBaseUrlDefault(provider, defaultBaseUrl)
      if (defaultModel) {
        process.env.OPENAI_MODEL ??= defaultModel
      }
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.FIREWORKS_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.FIREWORKS_API_KEY
      } else {
        delete process.env.OPENAI_API_KEY
      }
      break

    default:
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      applyOpenAIBaseUrlDefault(provider, defaultBaseUrl)
      if (defaultModel) {
        process.env.OPENAI_MODEL ??= defaultModel
      }
      if (model) process.env.OPENAI_MODEL = model
      break
  }

  return {}
}
