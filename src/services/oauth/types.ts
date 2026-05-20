export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'max'
  | 'team'
  | 'enterprise'
  | 'api'

export type RateLimitTier = string

export type BillingType =
  | 'individual'
  | 'team'
  | 'enterprise'
  | 'api'
  | string

export type OAuthProfileResponse = {
  account: {
    uuid: string
    email: string
    created_at?: string
    display_name?: string | null
    has_claude_max?: boolean | null
    has_claude_pro?: boolean | null
  }
  organization: {
    uuid: string
    billing_type?: BillingType | null
    has_extra_usage_enabled?: boolean | null
    subscription_created_at?: string | null
  }
}

export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
  }
  organization?: {
    uuid: string
  }
}

export type OAuthTokens = {
  accessToken: string
  refreshToken?: string
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

export type UserRolesResponse = {
  roles?: string[]
  organizations?: Array<{
    uuid: string
    role?: string
  }>
}

export type ReferralCampaign = 'claude_code_guest_pass' | (string & {})

export type ReferrerRewardInfo = {
  amount_minor_units: number
  currency: string
}

export type ReferralEligibilityResponse = {
  eligible: boolean
  referral_code_details?: {
    referral_link?: string | null
    campaign?: ReferralCampaign | null
  } | null
  referrer_reward?: ReferrerRewardInfo | null
  remaining_passes?: number | null
  [key: string]: unknown
}

export type ReferralRedemptionsResponse = {
  redemptions?: Array<{
    redeemed_at?: string | null
    [key: string]: unknown
  }>
  limit?: number
  [key: string]: unknown
}
