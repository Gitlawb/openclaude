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
} from '../integrations/index.js'
import { PRESET_VENDOR_MAP } from '../integrations/compatibility.js'

const PREFERRED_PROVIDER_ORDER = [
  'anthropic',
  'bankr',
  'zai',
  'xai',
  'openai',
  'gemini',
  'mistral',
  'github',
  'bedrock',
  'vertex',
  'ollama',
  'nvidia-nim',
  'minimax',
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
): { error?: string } | undefined {
  const provider = parseProviderFlag(args)
  if (!provider) return undefined
  return applyProviderFlag(provider, args)
}

/**
 * Extract the value of --model from argv.
 * Returns null if absent.
 */
function parseModelFlag(args: string[]): string | null {
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
    defaultModel: Array.isArray(defaultModel) ? defaultModel[0] : defaultModel,
  }
}

/**
 * Apply a provider name to process.env.
 * Sets the required CLAUDE_CODE_USE_* flag and any provider-specific
 * defaults (Ollama base URL, model routing). Does NOT overwrite values
 * that are already set — explicit env vars always win.
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

    case 'minimax':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= defaultBaseUrl ?? 'https://api.minimax.io/v1'
      process.env.OPENAI_MODEL ??= 'MiniMax-M2.5'
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

    default:
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      if (defaultBaseUrl) {
        process.env.OPENAI_BASE_URL ??= defaultBaseUrl
      }
      if (defaultModel) {
        process.env.OPENAI_MODEL ??= defaultModel
      }
      if (model) process.env.OPENAI_MODEL = model
      break

    case 'xai':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= 'https://api.x.ai/v1'
      process.env.OPENAI_MODEL ??= 'grok-4'
      if (model) process.env.OPENAI_MODEL = model
      if (process.env.XAI_API_KEY && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = process.env.XAI_API_KEY
      }
      break
  }

  return {}
}
