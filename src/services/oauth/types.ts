export type SubscriptionType = 'free' | 'pro' | 'max' | 'team' | 'enterprise'
export type RateLimitTier = 'unknown' | 'free' | 'pro' | 'max' | 'team' | 'enterprise'
export type BillingType =
  | 'individual'
  | 'team'
  | 'enterprise'
  | 'api'
  | 'partner'
  | 'unknown'

export type OAuthProfileResponse = {
  uuid?: string
  email?: string
  email_address?: string
  organization_uuid?: string | null
  organization_name?: string | null
  organization_role?: string | null
  workspace_role?: string | null
  display_name?: string
  has_extra_usage_enabled?: boolean
  billing_type?: BillingType | null
  account_created_at?: string
  subscription_created_at?: string
  subscription_type?: SubscriptionType | null
  rate_limit_tier?: RateLimitTier | null
  [key: string]: unknown
}

export type OAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes?: string[]
  subscriptionType?: SubscriptionType | null
  rateLimitTier?: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid?: string
  }
}

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
  [key: string]: unknown
}

export type UserRolesResponse = {
  organization_role?: string | null
  workspace_role?: string | null
  organization_name?: string | null
  [key: string]: unknown
}

export type ReferralCampaign = 'claude_code_guest_pass' | (string & {})

export type ReferrerRewardInfo = {
  amount_minor_units: number
  currency: string
  [key: string]: unknown
}

export type ReferralEligibilityResponse = {
  eligible: boolean
  campaign?: ReferralCampaign
  referral_code?: string | null
  referral_link?: string | null
  referral_code_details?: {
    campaign?: ReferralCampaign
    code?: string
    [key: string]: unknown
  } | null
  referrer_reward?: ReferrerRewardInfo | null
  remaining_passes?: number | null
  timestamp?: number
  [key: string]: unknown
}

export type ReferralRedemptionsResponse = {
  redemptions?: Array<Record<string, unknown>>
  limit?: number
  [key: string]: unknown
}
