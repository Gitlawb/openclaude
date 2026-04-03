/**
 * Router index - Unified router API
 *
 * Provides a unified interface for provider selection.
 * When ROUTER_MODE=smart, uses SmartRouter for intelligent routing.
 * Otherwise, falls back to simpleprovider selection.
 */

import { getAPIProvider, type APIProvider } from '../utils/model/providers.js'
import { SmartRouter, type RoutingResult } from './smartRouter.js'
import { logger } from '../utils/logger.js'

// ── Singleton instance ───────────────────────────────────────────────────────

let smartRouterInstance: SmartRouter | null = null

function getSmartRouter(): SmartRouter {
  if (!smartRouterInstance) {
    smartRouterInstance = new SmartRouter()
  }
  return smartRouterInstance
}

// ── Configuration ─────────────────────────────────────────────────────────────

const ROUTER_MODE = process.env.ROUTER_MODE ?? 'fixed'
const ROUTER_STRATEGY = (process.env.ROUTER_STRATEGY as 'latency' | 'cost' | 'balanced') ?? 'balanced'

function isSmartMode(): boolean {
  return ROUTER_MODE.toLowerCase() === 'smart'
}

// ── Public API ─────────────────────────────────────────────────────────────---

/**
 * Get the current provider (compatible with existing getAPIProvider)
 * When in smart mode, returns the best available provider based on strategy.
 */
export async function getActiveProvider(): Promise<APIProvider> {
  if (!isSmartMode()) {
    return getAPIProvider()
  }

  try {
    const router = getSmartRouter()
    const result = await router.selectProviderAsync()
    return result as APIProvider
  } catch (error) {
    logger.warning(`SmartRouter failed, falling back to default: ${error}`)
    return getAPIProvider()
  }
}

/**
 * Get provider with model (SmartRouter route result)
 * Use this for full routing information including the recommended model.
 */
export async function route(
  messages: Array<{ content?: unknown }>,
  claudeModel?: string,
): Promise<RoutingResult> {
  if (!isSmartMode()) {
    // Fixed mode: use simple provider selection
    const provider = getAPIProvider()
    return {
      provider,
      model: getDefaultModelForProvider(provider, claudeModel),
      apiKey: getApiKeyForProvider(provider),
      providerObject: null as never,
    }
  }

  const router = getSmartRouter()
  return router.route(messages, claudeModel)
}

/**
 * Initialize the smart router (ping all providers)
 */
export async function initializeSmartRouter(): Promise<void> {
  if (!isSmartMode()) {
    return
  }

  const router = getSmartRouter()
  await router.initialize()
}

/**
 * Record a request result for the router to learn from
 */
export async function recordProviderResult(
  providerName: string,
  success: boolean,
  durationMs: number,
): Promise<void> {
  if (!isSmartMode()) {
    return
  }

  const router = getSmartRouter()
  await router.recordResult(providerName, success, durationMs)
}

/**
 * Get router status (available when in smart mode)
 */
export function getRouterStatus(): Array<Record<string, unknown>> {
  if (!isSmartMode()) {
    return []
  }

  const router = getSmartRouter()
  return router.status()
}

/**
 * Check if smart routing is enabled
 */
export function isSmartRoutingEnabled(): boolean {
  return isSmartMode()
}

// ── Helpers ─────────────────────────────────────────────────────────────────--

function getDefaultModelForProvider(provider: APIProvider, claudeModel?: string): string {
  const model = claudeModel ?? 'claude-sonnet'

  switch (provider) {
    case 'firstParty':
      return model.includes('opus') ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514'
    case 'openai':
      return model.includes('mini') ? 'gpt-4o-mini' : 'gpt-4o'
    case 'gemini':
      return model.includes('flash') ? 'gemini-2.0-flash' : 'gemini-2.0-pro'
    case 'bedrock':
      return model.includes('opus') ? 'anthropic.claude-opus-4-20250514' : 'anthropic.claude-sonnet-4-20250514'
    case 'vertex':
      return model.includes('flash') ? 'gemini-2.0-flash' : 'gemini-2.0-pro'
    case 'github':
      return model.includes('mini') ? 'gpt-4o-mini' : 'gpt-4o'
    case 'codex':
      return 'codexplan'
    default:
      return 'claude-sonnet-4-20250514'
  }
}

function getApiKeyForProvider(provider: APIProvider): string {
  switch (provider) {
    case 'firstParty':
      return process.env.ANTHROPIC_API_KEY ?? ''
    case 'openai':
      return process.env.OPENAI_API_KEY ?? ''
    case 'gemini':
      return process.env.GEMINI_API_KEY ?? ''
    case 'bedrock':
    case 'vertex':
      return process.env.AWS_ACCESS_KEY_ID ?? ''
    case 'github':
      return process.env.GITHUB_TOKEN ?? ''
    case 'codex':
      return process.env.OPENAI_API_KEY ?? ''
    case 'foundry':
      return process.env.AZURE_AI_FOUNDRY_KEY ?? ''
    default:
      return ''
  }
}

// Re-export types
export type { RoutingStrategy, RoutingResult, Provider, ProviderBase } from './smartRouter.js'