/**
 * Smart Router Bridge
 * -------------------
 * Bridges Claude Code terminal with the Python smart router.
 * Provides TypeScript interface to the Python-based intelligent
 * provider routing system.
 *
 * Features:
 * - Health checks and provider status
 * - Request routing with automatic fallback
 * - Latency/cost optimization
 * - Seamless integration with existing provider configs
 */

import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'

// Simplified message type for router communication
export interface RouterMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | { type: string; text?: string }[]
}

export const SMART_ROUTER_HOST = process.env.SMART_ROUTER_HOST || 'localhost'
export const SMART_ROUTER_PORT = parseInt(
  process.env.SMART_ROUTER_PORT || '8080',
  10,
)
export const SMART_ROUTER_URL = `http://${SMART_ROUTER_HOST}:${SMART_ROUTER_PORT}`

export interface RouterProvider {
  name: string
  healthy: boolean
  configured: boolean
  latency_ms: number
  cost_per_1k: number
  requests: number
  errors: number
  error_rate: number
}

export interface RouterStatus {
  mode: 'smart' | 'fixed'
  strategy: 'latency' | 'cost' | 'balanced'
  providers: RouterProvider[]
  selected_provider?: string
}

export interface RouteRequest {
  messages: RouterMessage[]
  model?: string
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

export interface RouteResult {
  provider: string
  model: string
  success: boolean
  latency_ms: number
  content?: string
  error?: string
}

/**
 * Check if smart router is available and healthy
 */
export async function isSmartRouterAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(`${SMART_ROUTER_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get current router status and provider information
 */
export async function getRouterStatus(): Promise<RouterStatus | null> {
  try {
    const response = await fetch(`${SMART_ROUTER_URL}/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return (await response.json()) as RouterStatus
  } catch (error) {
    logForDebugging(`[SmartRouter] Status check failed: ${error}`)
    return null
  }
}

/**
 * Route a request through the smart router
 */
export async function routeThroughSmartRouter(
  request: RouteRequest,
): Promise<RouteResult> {
  const startTime = Date.now()

  try {
    logForDebugging(
      `[SmartRouter] Routing request to ${SMART_ROUTER_URL}/route`,
    )

    const response = await fetch(`${SMART_ROUTER_URL}/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Router HTTP ${response.status}: ${errorText}`)
    }

    const result = (await response.json()) as RouteResult
    result.latency_ms = Date.now() - startTime

    logForDebugging(
      `[SmartRouter] Routed to ${result.provider} in ${result.latency_ms}ms`,
    )

    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logError(`[SmartRouter] Routing failed: ${errorMsg}`)

    return {
      provider: 'unknown',
      model: request.model || 'unknown',
      success: false,
      latency_ms: Date.now() - startTime,
      error: errorMsg,
    }
  }
}

/**
 * Record outcome of a request for router learning
 */
export async function recordOutcome(
  provider: string,
  success: boolean,
  latencyMs: number,
): Promise<void> {
  try {
    await fetch(`${SMART_ROUTER_URL}/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        success,
        duration_ms: latencyMs,
      }),
    })
  } catch (error) {
    // Non-critical: don't throw
    logForDebugging(`[SmartRouter] Failed to record outcome: ${error}`)
  }
}

/**
 * Get the best provider for a specific request type
 */
export async function getBestProvider(
  modelType: 'big' | 'small' = 'big',
): Promise<string | null> {
  const status = await getRouterStatus()
  if (!status) return null

  const available = status.providers.filter(
    (p) => p.healthy && p.configured,
  )

  if (available.length === 0) return null

  // Sort by strategy
  const sorted = available.sort((a, b) => {
    switch (status.strategy) {
      case 'latency':
        return a.latency_ms - b.latency_ms
      case 'cost':
        return a.cost_per_1k - b.cost_per_1k
      case 'balanced':
      default:
        // Weighted score: 50% latency, 50% cost
        const scoreA = a.latency_ms * 0.5 + a.cost_per_1k * 100 * 0.5
        const scoreB = b.latency_ms * 0.5 + b.cost_per_1k * 100 * 0.5
        return scoreA - scoreB
    }
  })

  return sorted[0]?.name || null
}

/**
 * Enable smart router mode in environment
 */
export function enableSmartRouter(): void {
  process.env.ROUTER_MODE = 'smart'
  process.env.CLAUDE_CODE_USE_SMART_ROUTER = '1'
}

/**
 * Check if smart router mode is enabled
 */
export function isSmartRouterEnabled(): boolean {
  return (
    process.env.ROUTER_MODE === 'smart' ||
    process.env.CLAUDE_CODE_USE_SMART_ROUTER === '1'
  )
}
