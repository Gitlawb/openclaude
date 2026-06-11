// Stub — recreated type surface for the OAuth service (not included in
// source snapshot). Pure types: no runtime exports, no import-time effects.
// Shapes are derived from the consumers in client.ts, index.ts,
// getOauthProfile.ts, utils/auth.ts, utils/config.ts, cli/handlers/auth.ts,
// services/api/referral.ts, and components/Passes/Passes.tsx.

/**
 * Claude subscription tier. Open string union: the canonical values are
 * listed (client.ts maps organization_type to these), but mock/test paths
 * (services/mockRateLimits.ts) flow plain strings through.
 */
export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'max'
  | 'team'
  | 'enterprise'
  | (string & {})

/** Rate-limit tier from /api/oauth/profile (e.g. 'default_claude_max_5x'). */
export type RateLimitTier =
  | 'default_claude_max_1x'
  | 'default_claude_max_5x'
  | 'default_claude_max_20x'
  | (string & {})

/** Organization billing type from /api/oauth/profile. */
export type BillingType = string

/** Response from /api/oauth/profile (and /api/claude_cli_profile). */
export type OAuthProfileResponse = {
  account: {
    uuid: string
    email: string
    display_name?: string | null
    created_at?: string
    /** API-key-billed account also holds a Claude Max subscription */
    has_claude_max?: boolean
    /** API-key-billed account also holds a Claude Pro subscription */
    has_claude_pro?: boolean
  }
  organization: {
    uuid: string
    name?: string
    organization_type?: string
    billing_type?: BillingType | null
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean | null
    subscription_created_at?: string | null
  }
}

/** Raw token endpoint response (authorization_code / refresh_token grants). */
export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
  account?: {
    uuid: string
    email_address: string
  }
  organization?: {
    uuid: string
    name?: string
  }
}

/** Normalized OAuth tokens as stored in secure storage / used in-process. */
export type OAuthTokens = {
  accessToken: string
  refreshToken?: string | null
  /** Epoch millis; null for inference-only tokens with unknown expiry */
  expiresAt: number | null
  scopes: string[]
  subscriptionType?: SubscriptionType | null
  rateLimitTier?: RateLimitTier | null
  /** Raw profile pre-fetched during the token flow, if available */
  profile?: OAuthProfileResponse
  /** Account identity embedded in the token response, if present */
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid?: string
  }
}

/** Response from the organization roles endpoint. */
export type UserRolesResponse = {
  organization_role: string
  workspace_role: string | null
  organization_name: string
}

/** Referral campaign identifier (e.g. 'claude_code_guest_pass'). */
export type ReferralCampaign = 'claude_code_guest_pass' | (string & {})

/** Credit reward granted to the referrer when a referee subscribes. */
export type ReferrerRewardInfo = {
  /** ISO 4217 currency code (e.g. 'USD') */
  currency: string
  /** Amount in minor units (cents) */
  amount_minor_units: number
}

export type ReferralCodeDetails = {
  referral_link?: string
  campaign?: ReferralCampaign
  code?: string
}

/** Response from the referral eligibility endpoint (cached in config). */
export type ReferralEligibilityResponse = {
  eligible: boolean
  campaign?: ReferralCampaign
  referral_code_details?: ReferralCodeDetails | null
  referrer_reward?: ReferrerRewardInfo | null
  remaining_passes?: number | null
}

export type ReferralRedemption = {
  redeemed_at?: string
  redeemer_email?: string
}

/** Response from the referral redemptions endpoint. */
export type ReferralRedemptionsResponse = {
  redemptions?: ReferralRedemption[]
  limit?: number
}
