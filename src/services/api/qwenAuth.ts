/**
 * Qwen OAuth credential management for OpenClaude.
 *
 * Reads credentials from ~/.claude/qwen-oauth.json
 * (created by the Qwen OAuth flow via /provider → Qwen Coder).
 *
 * The actual API requests are handled by qwenProxy.ts, which
 * starts an internal HTTP proxy on localhost:8080 to forward
 * requests to the Qwen API with proper TLS fingerprinting.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================
// Constants
// ============================================================

const CLAUDE_DIR = join(homedir(), '.claude')
const QWEN_CREDENTIAL_FILENAME = 'qwen-oauth.json'
const QWEN_CREDENTIALS_PATH = join(CLAUDE_DIR, QWEN_CREDENTIAL_FILENAME)

const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai'
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'
const TOKEN_REFRESH_BUFFER_MS = 30 * 1000

export type QwenCredentials = {
  accessToken: string
  refreshToken?: string
  tokenType?: string
  resourceUrl?: string
  expiryDate?: number
  [key: string]: unknown
}

// ============================================================
// Credential management
// ============================================================

export function loadQwenCredentials(): QwenCredentials | null {
  if (!existsSync(QWEN_CREDENTIALS_PATH)) {
    return null
  }
  try {
    const raw = readFileSync(QWEN_CREDENTIALS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.accessToken) {
      return parsed as QwenCredentials
    }
    return null
  } catch {
    return null
  }
}

export function isQwenTokenValid(credentials: QwenCredentials | null): boolean {
  if (!credentials || !credentials.accessToken || !credentials.expiryDate) {
    return false
  }
  return Date.now() < credentials.expiryDate - TOKEN_REFRESH_BUFFER_MS
}

export function shouldRefreshQwenToken(credentials: QwenCredentials | null): boolean {
  if (!credentials || !credentials.accessToken || !credentials.expiryDate) {
    return true
  }
  return Date.now() >= credentials.expiryDate - TOKEN_REFRESH_BUFFER_MS
}

export async function refreshQwenAccessToken(
  credentials: QwenCredentials,
): Promise<QwenCredentials> {
  if (!credentials.refreshToken) {
    throw new Error(
      'No refresh token available. Please re-authenticate: /provider → Qwen Coder',
    )
  }

  const bodyData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: QWEN_OAUTH_CLIENT_ID,
  })

  const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: bodyData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `Token refresh failed: ${errorData.error || response.status} - ${errorData.error_description || 'Unknown error'}`,
    )
  }

  const tokenData = await response.json() as Record<string, unknown>

  const newCredentials: QwenCredentials = {
    ...credentials,
    accessToken: tokenData.access_token as string,
    tokenType: tokenData.token_type as string | undefined,
    refreshToken: (tokenData.refresh_token as string) || credentials.refreshToken,
    resourceUrl: (tokenData.resource_url as string) || credentials.resourceUrl,
    expiryDate: tokenData.expires_in
      ? Date.now() + (tokenData.expires_in as number) * 1000
      : credentials.expiryDate,
  }

  saveQwenCredentials(newCredentials)
  return newCredentials
}

export function saveQwenCredentials(credentials: QwenCredentials): void {
  if (!credentials.accessToken) {
    throw new Error('Cannot save credentials without accessToken')
  }
  try {
    mkdirSync(CLAUDE_DIR, { recursive: true })
    writeFileSync(
      QWEN_CREDENTIALS_PATH,
      JSON.stringify(credentials, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch (error) {
    console.error('Failed to save Qwen credentials:', error)
    throw error
  }
}
