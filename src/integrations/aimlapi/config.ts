/**
 * AI/ML API (aimlapi.com) integration - endpoint configuration.
 *
 * Wires OpenClaude to the AI/ML API passwordless onboarding and partner
 * checkout flow so a user can sign in, top up their balance, and have the issued key written back into
 * OpenClaude's provider profile automatically. Usage attributes to the Gitlawb
 * rebate partner (see the partner id below).
 *
 * Override any single URL via the corresponding `AIMLAPI_*_URL` env var.
 */

export type AimlapiEndpoints = {
  /** app/auth service - mints the user access (Bearer) token. */
  authBaseUrl: string
  /** app/gateway BFF - hosts `/v3/partner-checkout/*`. */
  appBaseUrl: string
  /** hosted checkout frontend base URL. */
  payBaseUrl: string
  /** OpenAI-compatible inference base URL written into the provider profile. */
  inferenceBaseUrl: string
  /** browser landing page after checkout / consent completes. */
  verificationBaseUrl: string
}

const DEFAULT_ENDPOINTS: AimlapiEndpoints = {
  authBaseUrl: 'https://auth.aimlapi.com',
  appBaseUrl: 'https://app.aimlapi.com',
  payBaseUrl: 'https://pay.aimlapi.com',
  inferenceBaseUrl: 'https://api.aimlapi.com/v1',
  verificationBaseUrl: 'https://aimlapi.com/app',
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
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5'
export const DEFAULT_RETURN_URL = 'https://aimlapi.com/app'

/** Top-up bounds enforced by the backend DTO (USD minor units / cents). */
export const MIN_AMOUNT_USD_MINOR = 2000 // $20
export const MAX_AMOUNT_USD_MINOR = 1_000_000 // $10,000
export const DEFAULT_AMOUNT_USD_MINOR = 2500 // $25

export function resolveEndpoints(): AimlapiEndpoints {
  return {
    authBaseUrl: process.env.AIMLAPI_AUTH_URL?.trim() || DEFAULT_ENDPOINTS.authBaseUrl,
    appBaseUrl: process.env.AIMLAPI_APP_URL?.trim() || DEFAULT_ENDPOINTS.appBaseUrl,
    payBaseUrl: process.env.AIMLAPI_PAY_URL?.trim() || DEFAULT_ENDPOINTS.payBaseUrl,
    inferenceBaseUrl:
      process.env.AIMLAPI_INFERENCE_URL?.trim() || DEFAULT_ENDPOINTS.inferenceBaseUrl,
    verificationBaseUrl:
      process.env.AIMLAPI_VERIFICATION_BASE_URL?.trim() ||
      DEFAULT_ENDPOINTS.verificationBaseUrl,
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

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

/** Catalog attribution and existing-key preflight are production-only. */
export function isCanonicalAimlapiInferenceBaseUrl(value: string): boolean {
  return normalizeBaseUrl(value) === normalizeBaseUrl(DEFAULT_ENDPOINTS.inferenceBaseUrl)
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
  payBaseUrl: string,
  sessionToken: string,
): { successUrl?: string; cancelUrl?: string } {
  const base = safeHttpBaseUrl(payBaseUrl)
  if (!base) return {}
  const token = encodeURIComponent(sessionToken)
  const query = (status: string): string =>
    `checkout=${status}&partnerCheckout=1&sessionToken=${token}`
  return {
    successUrl: `${base}/checkout?${query('success')}`,
    cancelUrl: `${base}/checkout?${query('cancel')}`,
  }
}

/**
 * Browser landing URL after checkout. OpenClaude learns success by polling, so
 * this must be an ordinary HTTPS page rather than an unregistered custom scheme.
 */
export function buildPartnerReturnUrl(frontendBaseUrl: string): string {
  const override = safeHttpBaseUrl(process.env.AIMLAPI_RETURN_URL)
  if (override) return override
  return safeHttpBaseUrl(frontendBaseUrl) ?? DEFAULT_RETURN_URL
}

function safeHttpBaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const loopback =
      url.hostname === 'localhost' ||
      /^127(?:\.\d+){3}$/.test(url.hostname) ||
      url.hostname === '[::1]'
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}
