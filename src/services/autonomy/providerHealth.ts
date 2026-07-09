/**
 * Provider health registry — latency EMA, error rate, healthy flag.
 * Ported from python/smart_router.py scoring ideas for the TS CLI path.
 */

import { logForDebugging } from '../../utils/debug.js'

export type HealthStrategy = 'latency' | 'cost' | 'balanced'

export type ProviderHealthEntry = {
  /** Model key as registered in agentModels */
  model: string
  baseURL: string
  latencyMs: number
  avgLatencyMs: number
  requestCount: number
  errorCount: number
  healthy: boolean
  lastError?: string
  lastCheckedAt?: number
  /** Optional cost weight for balanced scoring (USD per 1k tokens estimate) */
  costPer1kTokens: number
}

export type HealthSnapshot = {
  entries: ProviderHealthEntry[]
  recentRoutes: RouteLogEntry[]
}

export type RouteLogEntry = {
  ts: number
  model: string
  baseURL: string
  source: string
  tier?: string
  reason: string[]
  event: 'select' | 'success' | 'failure' | 'fallback'
}

const EMA_ALPHA = 0.3
const DEFAULT_COST = 0.001
const MAX_ROUTE_LOG = 40
/** Consecutive failures before marking unhealthy (success resets) */
const UNHEALTHY_AFTER_ERRORS = 2

type InternalEntry = ProviderHealthEntry & {
  consecutiveErrors: number
}

const registry = new Map<string, InternalEntry>()
const recentRoutes: RouteLogEntry[] = []

function registryKey(model: string, baseURL: string): string {
  return `${model}@@${baseURL}`
}

function ensureEntry(
  model: string,
  baseURL: string,
  costPer1kTokens = DEFAULT_COST,
): InternalEntry {
  const key = registryKey(model, baseURL)
  let entry = registry.get(key)
  if (!entry) {
    entry = {
      model,
      baseURL,
      latencyMs: 9999,
      avgLatencyMs: 9999,
      requestCount: 0,
      errorCount: 0,
      healthy: true,
      costPer1kTokens,
      consecutiveErrors: 0,
    }
    registry.set(key, entry)
  }
  return entry
}

function pushRoute(entry: RouteLogEntry): void {
  recentRoutes.push(entry)
  if (recentRoutes.length > MAX_ROUTE_LOG) {
    recentRoutes.shift()
  }
}

export function logRouteEvent(
  partial: Omit<RouteLogEntry, 'ts'> & { ts?: number },
): void {
  pushRoute({
    ts: partial.ts ?? Date.now(),
    model: partial.model,
    baseURL: partial.baseURL,
    source: partial.source,
    tier: partial.tier,
    reason: partial.reason,
    event: partial.event,
  })
}

export function recordSuccess(
  model: string,
  baseURL: string,
  durationMs: number,
): void {
  const entry = ensureEntry(model, baseURL)
  entry.requestCount++
  entry.consecutiveErrors = 0
  entry.healthy = true
  entry.latencyMs = durationMs
  entry.avgLatencyMs =
    entry.requestCount === 1
      ? durationMs
      : EMA_ALPHA * durationMs + (1 - EMA_ALPHA) * entry.avgLatencyMs
  entry.lastCheckedAt = Date.now()
  logRouteEvent({
    model,
    baseURL,
    source: 'telemetry',
    reason: [`durationMs=${Math.round(durationMs)}`],
    event: 'success',
  })
}

export function recordFailure(
  model: string,
  baseURL: string,
  errorMessage: string,
): void {
  const entry = ensureEntry(model, baseURL)
  entry.requestCount++
  entry.errorCount++
  entry.consecutiveErrors++
  entry.lastError = errorMessage.slice(0, 200)
  entry.lastCheckedAt = Date.now()
  if (entry.consecutiveErrors >= UNHEALTHY_AFTER_ERRORS) {
    entry.healthy = false
    logForDebugging(
      `[autonomy] provider unhealthy model=${model} baseURL=${baseURL} errors=${entry.consecutiveErrors}`,
      { level: 'warn' },
    )
  }
  logRouteEvent({
    model,
    baseURL,
    source: 'telemetry',
    reason: [errorMessage.slice(0, 120)],
    event: 'failure',
  })
}

export function markHealthy(model: string, baseURL: string): void {
  const entry = ensureEntry(model, baseURL)
  entry.healthy = true
  entry.consecutiveErrors = 0
}

export function isProviderHealthy(model: string, baseURL: string): boolean {
  const key = registryKey(model, baseURL)
  const entry = registry.get(key)
  // Unknown providers are assumed healthy until proven otherwise
  if (!entry) return true
  return entry.healthy
}

export function getErrorRate(entry: ProviderHealthEntry): number {
  if (entry.requestCount === 0) return 0
  return entry.errorCount / entry.requestCount
}

/**
 * Lower score = better provider (matches python smart_router).
 */
export function scoreProvider(
  entry: ProviderHealthEntry,
  strategy: HealthStrategy = 'balanced',
): number {
  if (!entry.healthy) return Number.POSITIVE_INFINITY

  const latencyScore = entry.avgLatencyMs / 1000
  const costScore = entry.costPer1kTokens * 100
  const errorPenalty = getErrorRate(entry) * 500

  if (strategy === 'latency') return latencyScore + errorPenalty
  if (strategy === 'cost') return costScore + errorPenalty
  return latencyScore * 0.5 + costScore * 0.5 + errorPenalty
}

/**
 * Ping an OpenAI-compatible or Ollama endpoint.
 * Returns latency ms or null if unreachable.
 */
export async function pingProvider(
  baseURL: string,
  apiKey?: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; latencyMs: number; status?: number; error?: string }> {
  const start = Date.now()
  const normalized = baseURL.replace(/\/$/, '')
  // Prefer /models (OpenAI-compat); Ollama also serves /v1/models when using /v1 base
  const url = `${normalized}/models`

  try {
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    // 200/401/403 all mean the host is reachable
    const ok = [200, 400, 401, 403].includes(resp.status)
    return { ok, latencyMs, status: resp.status }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Probe a model endpoint and update registry health.
 */
export async function probeAndUpdate(
  model: string,
  baseURL: string,
  apiKey?: string,
): Promise<ProviderHealthEntry> {
  const result = await pingProvider(baseURL, apiKey)
  const entry = ensureEntry(model, baseURL)
  entry.lastCheckedAt = Date.now()
  entry.latencyMs = result.latencyMs
  if (result.ok) {
    entry.healthy = true
    entry.consecutiveErrors = 0
    entry.avgLatencyMs =
      entry.avgLatencyMs === 9999
        ? result.latencyMs
        : EMA_ALPHA * result.latencyMs + (1 - EMA_ALPHA) * entry.avgLatencyMs
  } else {
    entry.healthy = false
    entry.lastError = result.error ?? `status=${result.status}`
  }
  return { ...entry }
}

export function getHealthSnapshot(): HealthSnapshot {
  return {
    entries: Array.from(registry.values()).map(e => ({
      model: e.model,
      baseURL: e.baseURL,
      latencyMs: e.latencyMs,
      avgLatencyMs: e.avgLatencyMs,
      requestCount: e.requestCount,
      errorCount: e.errorCount,
      healthy: e.healthy,
      lastError: e.lastError,
      lastCheckedAt: e.lastCheckedAt,
      costPer1kTokens: e.costPer1kTokens,
    })),
    recentRoutes: [...recentRoutes],
  }
}

/** Test helper — clear in-memory state */
export function resetHealthRegistryForTests(): void {
  registry.clear()
  recentRoutes.length = 0
}
