/**
 * Client for the Gitlawb Ads service (ads.gitlawb.com).
 *
 * openclaude shows opt-in "sponsored tips" during inference waits; a viewer who
 * dwells on one earns opengateway credits. This module is the thin HTTP client:
 * fetch the next tip, then confirm it after the dwell so the viewer is credited.
 * The viewer is identified by an earn code (issued in the opengateway Earn tab,
 * stored in openclaude config), sent as the `x-earn-code` header.
 *
 * Earning is bounded and server-authoritative — the gateway/ads service signs
 * the impression token and measures dwell itself; this client just relays it.
 */
import { fetchWithProxyRetry } from './api/fetchWithProxyRetry.js'

const DEFAULT_ADS_BASE_URL = 'https://ads.gitlawb.com'

export function adsBaseUrl(): string {
  return (process.env.ADS_BASE_URL ?? DEFAULT_ADS_BASE_URL).replace(/\/$/, '')
}

export type SponsoredTip = {
  impressionId: string
  token: string
  text: string
  name: string
  link: string
  label: string
  dwellMs: number
}

export type ConfirmResult = {
  status: string
  earnedMicro: number
  balanceMicro?: number
}

const COMMON_HEADERS = (earnCode: string): Record<string, string> => ({
  'content-type': 'application/json',
  'user-agent': 'gitlawb-openclaude-ads',
  'x-earn-code': earnCode,
})

/**
 * Fetch the next sponsored tip for this viewer. Returns null when there's
 * nothing to serve (empty inventory) or on any error — ads must never break or
 * block the host CLI, so failures degrade silently to "no tip".
 */
export async function fetchNextTip(
  earnCode: string,
  surface = 'openclaude',
): Promise<SponsoredTip | null> {
  try {
    const url = `${adsBaseUrl()}/api/ads/next?surface=${encodeURIComponent(surface)}`
    const resp = await fetchWithProxyRetry(
      url,
      { method: 'GET', headers: COMMON_HEADERS(earnCode) },
      { maxAttempts: 2 },
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as Record<string, unknown>
    if (!data || data.ad === null || typeof data.token !== 'string') return null
    return {
      impressionId: String(data.impression_id),
      token: String(data.token),
      text: String(data.tip_text ?? ''),
      name: String(data.name ?? ''),
      link: String(data.link ?? ''),
      label: String(data.label ?? 'Sponsored'),
      dwellMs: Number(data.dwell_ms ?? 5000),
    }
  } catch {
    return null
  }
}

/**
 * Confirm a shown tip after its dwell elapsed, crediting the viewer. Returns the
 * settle status + amount earned. Throws only on transport failure; callers in
 * the render path should swallow that (earning is best-effort).
 */
export async function confirmTip(
  earnCode: string,
  token: string,
): Promise<ConfirmResult> {
  const resp = await fetchWithProxyRetry(
    `${adsBaseUrl()}/api/ads/confirm`,
    {
      method: 'POST',
      headers: COMMON_HEADERS(earnCode),
      body: JSON.stringify({ token }),
    },
    { maxAttempts: 2 },
  )
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  return {
    status: String(data.status ?? (resp.ok ? 'unknown' : 'error')),
    earnedMicro: Number(data.earned_micro ?? 0),
    balanceMicro:
      data.balance_micro !== undefined ? Number(data.balance_micro) : undefined,
  }
}
