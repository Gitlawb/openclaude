export type SecureStorageData = {
  oauthToken?: string
  claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
    scopes?: string[]
    subscriptionType?: string | null
    rateLimitTier?: string | null
    [key: string]: unknown
  }
  trustedDeviceToken?: string
  pluginSecrets?: Record<string, Record<string, string>>
  pluginOptions?: Record<string, Record<string, unknown>>
  mcpOAuth?: Record<string, Record<string, unknown>>
  mcpOAuthClientConfig?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type SecureStorage = {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}
