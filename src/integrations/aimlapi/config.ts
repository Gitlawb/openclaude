/**
 * AI/ML API (aimlapi.com) integration - endpoint configuration.
 *
 * Wires OpenClaude to the AI/ML API "partner checkout" flow so a user can log
 * in, top up their balance, and have the issued key written back into
 * OpenClaude's provider profile automatically. Usage attributes to the Gitlawb
 * rebate partner (see the partner id below).
 *
 * Override any single URL via the `AIMLAPI_AUTH_URL`, `AIMLAPI_APP_URL`, or
 * `AIMLAPI_INFERENCE_URL` env vars.
 */

export type AimlapiEndpoints = {
  /** app/auth service - mints the user access (Bearer) token. */
  authBaseUrl: string
  /** app/gateway BFF - hosts `/v3/partner-checkout/*`. */
  appBaseUrl: string
  /** OpenAI-compatible inference base URL written into the provider profile. */
  inferenceBaseUrl: string
}

const DEFAULT_ENDPOINTS: AimlapiEndpoints = {
  authBaseUrl: 'https://auth.aimlapi.com',
  appBaseUrl: 'https://app.aimlapi.com',
  inferenceBaseUrl: 'https://api.aimlapi.com/v1',
}

/**
 * Partner id (`^part_[A-Za-z0-9]{1,64}$`) - rebate attribution. Must EXACTLY
 * match an active row in the backend `rebate_partners` table. This is the
 * Gitlawb partner that all OpenClaude AI/ML API usage is credited to; it is the
 * same value sent as the `X-AIMLAPI-Partner-ID` inference header (see
 * `integrations/gateways/aimlapi.ts`).
 */
export const DEFAULT_PARTNER_ID = 'part_62yQoGYDq4Yqnrj2R1iGrDNJ'
export const DEFAULT_PARTNER_NAME = 'Gitlawb'
export const PARTNER_HEADER_NAME = 'X-AIMLAPI-Partner-ID'

/** Default model id written into the profile - override with `--model`. */
export const DEFAULT_MODEL = 'gpt-4o'

/** Top-up bounds enforced by the backend DTO (USD minor units / cents). */
export const MIN_AMOUNT_USD_MINOR = 2000 // $20
export const MAX_AMOUNT_USD_MINOR = 1_000_000 // $10,000
export const DEFAULT_AMOUNT_USD_MINOR = 2500 // $25

export function resolveEndpoints(): AimlapiEndpoints {
  return {
    authBaseUrl: process.env.AIMLAPI_AUTH_URL?.trim() || DEFAULT_ENDPOINTS.authBaseUrl,
    appBaseUrl: process.env.AIMLAPI_APP_URL?.trim() || DEFAULT_ENDPOINTS.appBaseUrl,
    inferenceBaseUrl:
      process.env.AIMLAPI_INFERENCE_URL?.trim() || DEFAULT_ENDPOINTS.inferenceBaseUrl,
  }
}

/** Resolve checkout and inference attribution with one shared precedence. */
export function resolvePartnerId(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.AIMLAPI_PARTNER_ID?.trim() ||
    DEFAULT_PARTNER_ID
  )
}

/**
 * Return a header copy with the effective partner id. Header matching is
 * case-insensitive so an override replaces the catalog spelling instead of
 * creating a duplicate header.
 */
export function withResolvedPartnerHeader(
  headers: Readonly<Record<string, string>>,
  explicit?: string,
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name.trim().toLowerCase() === PARTNER_HEADER_NAME.toLowerCase()) continue
    resolved[name] = value
  }
  resolved[PARTNER_HEADER_NAME] = resolvePartnerId(explicit)
  return resolved
}

function parseCanonicalUrl(
  value: string,
): { origin: string; pathname: string } | null {
  try {
    const url = new URL(value.trim())
    // `origin` already lowercases protocol and host. Collapse only a single
    // trailing slash so `/v1` and `/v1/` match, while `/v1//`, `/V1`, or
    // `/v1/anything` stay distinct from the canonical `/v1` path.
    return { origin: url.origin, pathname: url.pathname.replace(/\/$/, '') }
  } catch {
    return null
  }
}

/**
 * Catalog attribution and existing-key preflight are production-only. This
 * predicate gates ambient-credential forwarding, so it compares parsed origins
 * (host/protocol case-insensitive) and a case-sensitive path: a look-alike like
 * `/V1` or `/v1////` must NOT be treated as the canonical endpoint.
 */
export function isCanonicalAimlapiInferenceBaseUrl(value: string): boolean {
  const canonical = parseCanonicalUrl(DEFAULT_ENDPOINTS.inferenceBaseUrl)
  const candidate = parseCanonicalUrl(value)
  return (
    canonical !== null &&
    candidate !== null &&
    candidate.origin === canonical.origin &&
    candidate.pathname === canonical.pathname
  )
}

/**
 * Attribution headers AI/ML API records for canonical `api.aimlapi.com`
 * traffic. They identify the partner and the referring integration, so they
 * belong to the canonical endpoint only — see `resolveAimlapiAttributionHeaders`.
 */
const CATALOG_ATTRIBUTION_HEADER_NAMES = new Set([
  PARTNER_HEADER_NAME.toLowerCase(),
  'x-aimlapi-integration-repo',
  'x-aimlapi-integration-version',
  'http-referer',
  'x-title',
])

/**
 * Resolve the aimlapi catalog headers for an outbound request. On the canonical
 * inference endpoint the partner id is resolved and attribution is sent; on any
 * other base URL (a user-controlled proxy) every attribution header is stripped,
 * so a third-party host never receives OpenClaude's partner identity.
 *
 * Both the inference (openai shim) and the model-discovery request paths route
 * through here, so the two cannot drift apart. A missing base URL means the
 * caller falls back to the route default, which is canonical.
 */
export function resolveAimlapiAttributionHeaders(
  headers: Readonly<Record<string, string>>,
  baseUrl: string | undefined,
): Record<string, string> {
  if (!baseUrl || isCanonicalAimlapiInferenceBaseUrl(baseUrl)) {
    return withResolvedPartnerHeader(headers)
  }

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !CATALOG_ATTRIBUTION_HEADER_NAMES.has(name.trim().toLowerCase()),
    ),
  )
}

/**
 * Build the co-branded checkout return URLs the hosted payment page redirects
 * to after the user pays or cancels. Carrying `sessionToken` + `partnerCheckout=1`
 * makes the AI/ML API `/checkout` page resolve the partner (name + logo + amount)
 * and render the co-branded success / failure screen instead of the
 * generic top-up result. Without these params the backend falls back to a bare
 * `/checkout?checkout=success` that is NOT co-branded.
 */
export function buildPartnerCheckoutReturnUrls(
  appBaseUrl: string,
  sessionToken: string,
): { successUrl: string; cancelUrl: string } {
  const base = appBaseUrl.replace(/\/+$/, '')
  const token = encodeURIComponent(sessionToken)
  const query = (status: string): string =>
    `checkout=${status}&partnerCheckout=1&sessionToken=${token}`
  return {
    successUrl: `${base}/checkout?${query('success')}`,
    cancelUrl: `${base}/checkout?${query('cancel')}`,
  }
}
