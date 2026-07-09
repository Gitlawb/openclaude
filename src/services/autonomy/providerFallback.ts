/**
 * Provider/model fallback chain for autonomy routing.
 * Selects a healthy model from the chain and advances on failover errors.
 */

import type { SettingsJson } from '../../utils/settings/types.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import type { ProviderOverride } from '../api/agentRouting.js'
import {
  isProviderHealthy,
  logRouteEvent,
  recordFailure,
  recordSuccess,
} from './providerHealth.js'

export type FallbackCapableOverride = ProviderOverride & {
  autonomy?: NonNullable<ProviderOverride['autonomy']>
}

function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

function lookupModel(
  models: NonNullable<SettingsJson['agentModels']>,
  modelName: string,
): { name: string; base_url: string; api_key: string } | null {
  if (models[modelName]) {
    return { name: modelName, ...models[modelName]! }
  }
  const target = normalize(modelName)
  for (const [key, value] of Object.entries(models)) {
    if (normalize(key) === target) {
      return { name: key, ...value }
    }
  }
  return null
}

/**
 * Errors that justify switching provider/model (not prompt/content bugs).
 */
export function isProviderFailoverError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const status = (error as { status?: number }).status
  if (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 529 ||
    status === 500
  ) {
    return true
  }

  const name = (error as { name?: string }).name ?? ''
  if (
    name === 'APIConnectionError' ||
    name === 'APIConnectionTimeoutError' ||
    name === 'FetchError'
  ) {
    return true
  }

  const msg = errorMessage(error).toLowerCase()
  if (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('overloaded') ||
    msg.includes('capacity')
  ) {
    return true
  }

  return false
}

/**
 * If the primary model is known-unhealthy, walk fallbackChain for the first
 * healthy model present in agentModels. Returns the (possibly same) override.
 */
export function applyHealthSelection(
  override: FallbackCapableOverride,
  settings: SettingsJson | null,
): FallbackCapableOverride {
  if (!settings?.agentModels) return override

  const primaryHealthy = isProviderHealthy(override.model, override.baseURL)
  if (primaryHealthy) {
    logRouteEvent({
      model: override.model,
      baseURL: override.baseURL,
      source: override.autonomy?.source ?? 'static',
      tier: override.autonomy?.tier,
      reason: override.autonomy?.reason ?? ['primary healthy'],
      event: 'select',
    })
    return override
  }

  const chain = override.autonomy?.fallbackChain ?? []
  for (const candidate of chain) {
    const cfg = lookupModel(settings.agentModels, candidate)
    if (!cfg) continue
    if (!isProviderHealthy(cfg.name, cfg.base_url)) continue

    const next: FallbackCapableOverride = {
      model: cfg.name,
      baseURL: cfg.base_url,
      apiKey: cfg.api_key,
      effort: override.effort,
      autonomy: {
        tier: override.autonomy?.tier ?? 'standard',
        reason: [
          ...(override.autonomy?.reason ?? []),
          `health-override: ${override.model} unhealthy → ${cfg.name}`,
        ],
        fallbackChain: chain.filter(m => m !== cfg.name),
        source: 'health-override',
      },
    }
    logForDebugging(
      `[autonomy] health-override from ${override.model} to ${cfg.name}`,
      { level: 'warn' },
    )
    logRouteEvent({
      model: next.model,
      baseURL: next.baseURL,
      source: 'health-override',
      tier: next.autonomy?.tier,
      reason: next.autonomy?.reason ?? [],
      event: 'fallback',
    })
    return next
  }

  // No healthy alternative — keep primary (may still work)
  logRouteEvent({
    model: override.model,
    baseURL: override.baseURL,
    source: override.autonomy?.source ?? 'static',
    tier: override.autonomy?.tier,
    reason: [
      ...(override.autonomy?.reason ?? []),
      'primary unhealthy but no healthy fallback',
    ],
    event: 'select',
  })
  return override
}

/**
 * Advance to the next model in the fallback chain after a live API failure.
 * Marks the current model as failed; returns null if chain exhausted.
 */
export function advanceFallbackOnFailure(
  override: FallbackCapableOverride,
  settings: SettingsJson | null,
  error: unknown,
): FallbackCapableOverride | null {
  if (!settings?.agentModels) return null

  const errMsg = errorMessage(error)
  recordFailure(override.model, override.baseURL, errMsg)

  const chain = override.autonomy?.fallbackChain ?? []
  // Also consult settings fallbackChains by tier if autonomy chain empty
  const tier = override.autonomy?.tier
  const settingsChain =
    (tier && settings.fallbackChains?.[tier]) ||
    settings.fallbackChains?.default ||
    []
  const candidates = chain.length > 0 ? chain : settingsChain

  for (const candidate of candidates) {
    if (candidate === override.model) continue
    const cfg = lookupModel(settings.agentModels, candidate)
    if (!cfg) continue

    const next: FallbackCapableOverride = {
      model: cfg.name,
      baseURL: cfg.base_url,
      apiKey: cfg.api_key,
      effort: override.effort,
      autonomy: {
        tier: override.autonomy?.tier ?? 'standard',
        reason: [
          ...(override.autonomy?.reason ?? []),
          `fallback after error on ${override.model}: ${errMsg.slice(0, 80)}`,
        ],
        fallbackChain: candidates.filter(
          m => m !== cfg.name && m !== override.model,
        ),
        source: 'fallback',
      },
    }

    logForDebugging(
      `[autonomy] fallback from ${override.model} to ${cfg.name} reason=${errMsg.slice(0, 80)}`,
      { level: 'warn' },
    )
    logRouteEvent({
      model: next.model,
      baseURL: next.baseURL,
      source: 'fallback',
      tier: next.autonomy?.tier,
      reason: next.autonomy?.reason ?? [],
      event: 'fallback',
    })
    return next
  }

  return null
}

export function recordProviderSuccess(
  override: ProviderOverride,
  durationMs: number,
): void {
  recordSuccess(override.model, override.baseURL, durationMs)
}

export function recordProviderFailure(
  override: ProviderOverride,
  error: unknown,
): void {
  recordFailure(override.model, override.baseURL, errorMessage(error))
}
