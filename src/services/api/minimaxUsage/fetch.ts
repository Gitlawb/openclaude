import { createCombinedAbortSignal } from '../../../utils/combinedAbortSignal.js'
import { logForDebugging } from '../../../utils/debug.js'
import { sanitizeApiKey } from '../../../utils/providerSecrets.js'
import { getClaudeCodeUserAgent } from '../../../utils/userAgent.js'
import {
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_CN_BASE_URL,
  DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE,
  type MiniMaxUsageData,
} from './types.js'
import { normalizeMiniMaxUsagePayload } from './parse.js'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

// Region-routed default: pick the China usage endpoint when the configured
// base URL is api.minimaxi.com (and we have to fall back to a default).
// Avoids forwarding a China MiniMax bearer key to api.minimax.io's quota
// endpoint (#2207 P2).
function defaultBaseUrlForConfigured(configuredBaseUrl?: string): string {
  if (!configuredBaseUrl?.trim()) return DEFAULT_MINIMAX_BASE_URL
  try {
    const hostname = new URL(configuredBaseUrl.trim()).hostname.toLowerCase()
    return hostname === 'api.minimaxi.com'
      ? DEFAULT_MINIMAX_CN_BASE_URL
      : DEFAULT_MINIMAX_BASE_URL
  } catch {
    return DEFAULT_MINIMAX_BASE_URL
  }
}

// Convert a configured MiniMax env var into the quota /v1 root. The native
// preset emits an Anthropic-compatible chat root (`…/anthropic`); the quota
// API lives under the OpenAI-shaped root (`…/v1`). The two must not be
// treated as interchangeable — overseas native `/usage` regressed on
// earlier commits when chat base flowed verbatim into quota resolution
// (#2207 P1 follow-up from jatmn).
//
// Behavior:
//   https://api.minimaxi.com/anthropic  →  https://api.minimaxi.com/v1
//   https://api.minimaxi.com/v1         →  https://api.minimaxi.com/v1   (already /v1)
//   https://api.minimax.io/anthropic    →  https://api.minimax.io/v1
//   https://api.minimax.io/v1           →  https://api.minimax.io/v1    (already /v1)
//   custom Anthropic-compatible proxy   →  hostname if MiniMax → that
//                                          vendor's /v1; otherwise null
//                                          (non-MiniMax URLs cannot serve
//                                          the MiniMax quota API).
export function chatBaseToQuotaBase(baseUrl: string | undefined): string | null {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    const hostname = parsed.hostname.toLowerCase()
    const isCnHost = hostname === 'api.minimaxi.com'
    const isOverseasHost =
      hostname === 'api.minimax.io' || hostname === 'api.minimax.chat'
    if (!isCnHost && !isOverseasHost) return null
    // Both `/anthropic` and `/v1` shapes collapse to the same `/v1` root
    // because the quota API is OpenAI-shaped.
    const origin = `${parsed.protocol}//${parsed.host}`
    return `${origin}/v1`
  } catch {
    return null
  }
}

export function resolveMiniMaxUsageBaseUrl(
  baseUrl = process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    defaultBaseUrlForConfigured(
      process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE,
    ),
): string {
  const trimmed = baseUrl.trim()
  return trimmed ? trimTrailingSlash(trimmed) : DEFAULT_MINIMAX_BASE_URL
}

function resolveConfiguredMiniMaxUsageBaseUrl(
  baseUrl?: string,
): { baseUrl: string; usedDefault: boolean } {
  if (baseUrl !== undefined) {
    const trimmed = baseUrl.trim()
    if (trimmed) {
      return { baseUrl: trimTrailingSlash(trimmed), usedDefault: false }
    }
  }

  // Resolve the active MiniMax URL across every alias, then translate the
  // chat-shape URL into the quota /v1 root. Custom Anthropic-compatible
  // proxies do not serve the MiniMax quota API, so chatBaseToQuotaBase
  // returns null and we fall back to the region-routed default.
  const fromEnv =
    process.env.ANTHROPIC_BASE_URL ??
    process.env.MINIMAX_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE

  const quotaBase = chatBaseToQuotaBase(fromEnv)
  if (quotaBase) {
    return { baseUrl: quotaBase, usedDefault: false }
  }

  if (!fromEnv?.trim()) {
    return {
      baseUrl: defaultBaseUrlForConfigured(fromEnv),
      usedDefault: true,
    }
  }

  // Non-MiniMax custom URL: respect its region for the default fallback.
  return {
    baseUrl: defaultBaseUrlForConfigured(fromEnv),
    usedDefault: true,
  }
}

function buildUnavailableResult(message: string): MiniMaxUsageData {
  return {
    availability: 'unknown',
    snapshots: [],
    message,
  }
}

export function getMiniMaxUsageUrls(baseUrl?: string): string[] {
  const { baseUrl: resolvedBaseUrl, usedDefault } =
    resolveConfiguredMiniMaxUsageBaseUrl(baseUrl)

  try {
    const base = new URL(`${resolvedBaseUrl}/`)
    return [
      new URL('token_plan/remains', base).toString(),
      new URL('api/openplatform/coding_plan/remains', base).toString(),
    ]
  } catch {
    if (usedDefault) {
      // Same region-routed default selection used in the happy path above,
      // so a CN configured base still falls back to the CN endpoint.
      const fallbackBase = new URL(`${defaultBaseUrlForConfigured(baseUrl)}/`)
      return [
        new URL('token_plan/remains', fallbackBase).toString(),
        new URL('api/openplatform/coding_plan/remains', fallbackBase).toString(),
      ]
    }

    throw new Error(
      `MiniMax usage base URL is invalid: ${resolvedBaseUrl}`,
    )
  }
}

export async function fetchMiniMaxUsage(): Promise<MiniMaxUsageData> {
  // Require an explicit MINIMAX_API_KEY. Falling back to OPENAI_API_KEY
  // would forward an unrelated provider's credential to the MiniMax quota
  // endpoint — a credential leak (#2207 P1).
  const apiKey = sanitizeApiKey(process.env.MINIMAX_API_KEY)
  if (!apiKey) {
    throw new Error(
      'MiniMax auth is required. Set MINIMAX_API_KEY.',
    )
  }

  const usageUrls = getMiniMaxUsageUrls()
  const nonFatalFailures: Array<{ status: number; body: string }> = []
  let lastFatalError: Error | null = null

  for (const usageUrl of usageUrls) {
    let response: Response
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 5000,
    })
    try {
      try {
        response = await fetch(usageUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': getClaudeCodeUserAgent(),
          },
          signal,
        })
      } catch (error) {
        logForDebugging(
          `[minimax] usage request failed for ${usageUrl}: ${error instanceof Error ? error.message : String(error)}`,
          { level: 'warn' },
        )
        lastFatalError =
          error instanceof Error ? error : new Error(String(error))
        continue
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        if ([400, 401, 403, 404].includes(response.status)) {
          nonFatalFailures.push({ status: response.status, body: errorBody })
          continue
        }
        lastFatalError = new Error(
          `MiniMax usage error ${response.status}: ${errorBody || 'unknown error'}`,
        )
        continue
      }

      const normalized = normalizeMiniMaxUsagePayload(await response.json())
      if (normalized.availability === 'available') {
        return normalized
      }
    } finally {
      cleanup()
    }
  }

  if (nonFatalFailures.length > 0) {
    const latest = nonFatalFailures[nonFatalFailures.length - 1]
    logForDebugging(
      `[minimax] usage endpoint returned non-fatal status ${latest.status}: ${latest.body}`,
      { level: 'warn' },
    )
    return buildUnavailableResult(DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE)
  }

  if (lastFatalError) {
    throw lastFatalError
  }

  return buildUnavailableResult(DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE)
}
