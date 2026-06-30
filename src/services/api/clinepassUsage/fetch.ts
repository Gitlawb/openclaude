import { createCombinedAbortSignal } from '../../../utils/combinedAbortSignal.js'
import { logForDebugging } from '../../../utils/debug.js'
import { getClaudeCodeUserAgent } from '../../../utils/userAgent.js'
import {
  DEFAULT_CLINEPASS_BASE_URL,
  DEFAULT_CLINEPASS_UNAVAILABLE_MESSAGE,
  type ClinePassUsageData,
} from './types.js'
import { normalizeClinePassUsagePayload } from './parse.js'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function resolveClinePassUsageBaseUrl(): string {
  return DEFAULT_CLINEPASS_BASE_URL
}

function buildUnavailableResult(message: string): ClinePassUsageData {
  return {
    availability: 'unknown',
    windows: [],
    message,
  }
}

export function getClinePassUsageUrl(): string {
  const base = trimTrailingSlash(DEFAULT_CLINEPASS_BASE_URL)
  return `${base}/api/v1/users/me/plan/usage-limits`
}

export async function fetchClinePassUsage(): Promise<ClinePassUsageData> {
  const apiKey = process.env.CLINE_API_KEY
  if (!apiKey) {
    throw new Error(
      'ClinePass auth is required. Set CLINE_API_KEY.',
    )
  }

  const usageUrl = getClinePassUsageUrl()
  let response: Response

  const { signal, cleanup } = createCombinedAbortSignal(undefined, {
    timeoutMs: 10000,
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
        `[clinepass] usage request failed for ${usageUrl}: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' },
      )
      throw error instanceof Error ? error : new Error(String(error))
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      logForDebugging(
        `[clinepass] usage endpoint returned status ${response.status}: ${errorBody}`,
        { level: 'warn' },
      )
      return buildUnavailableResult(DEFAULT_CLINEPASS_UNAVAILABLE_MESSAGE)
    }

    const normalized = normalizeClinePassUsagePayload(await response.json())
    return normalized
  } finally {
    cleanup()
  }
}
