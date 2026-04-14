/**
 * Qwen OAuth Device Code Flow with PKCE.
 *
 * Replicates the exact same flow as the Qwen Code CLI:
 * 1. Generate PKCE pair (code_verifier + code_challenge)
 * 2. Request device code from chat.qwen.ai
 * 3. Open browser for user authentication
 * 4. Poll for token until user completes auth
 * 5. Save credentials to ~/.claude/qwen-oauth.json
 *
 * This allows OpenClaude to authenticate with Qwen OAuth
 * without requiring the Qwen Code CLI to be installed.
 */

import { randomBytes, createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// ============================================================
// Constants — exact same values as Qwen Code CLI
// ============================================================

const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai'
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion'
const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

const CLAUDE_DIR = join(homedir(), '.claude')
const QWEN_CREDENTIAL_FILENAME = 'qwen-oauth.json'
const QWEN_CREDENTIALS_PATH = join(CLAUDE_DIR, QWEN_CREDENTIAL_FILENAME)

export type QwenDeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval?: number
}

export type QwenCredentials = {
  access_token: string
  refresh_token?: string
  token_type?: string
  resource_url?: string
  expiry_date?: number
}

// ============================================================
// PKCE Generation — exact same as Qwen Code CLI
// ============================================================

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256')
  hash.update(codeVerifier)
  return hash.digest('base64url')
}

function generatePKCEPair(): { code_verifier: string; code_challenge: string } {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  return { code_verifier: codeVerifier, code_challenge: codeChallenge }
}

function objectToUrlEncoded(data: Record<string, string>): string {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&')
}

// ============================================================
// Browser launch
// ============================================================

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      await execAsync(`start "" "${url}"`)
    } else if (platform === 'darwin') {
      await execAsync(`open "${url}"`)
    } else {
      await execAsync(`xdg-open "${url}" 2>/dev/null || echo "Please open: ${url}"`)
    }
  } catch {
    // Non-critical — user can open manually
  }
}

// ============================================================
// Device Code Flow
// ============================================================

/**
 * Step 1: Request device code from Qwen OAuth server.
 */
async function requestDeviceCode(codeChallenge: string): Promise<QwenDeviceCodeResponse> {
  const body = objectToUrlEncoded({
    client_id: QWEN_OAUTH_CLIENT_ID,
    scope: QWEN_OAUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Device authorization failed: ${response.status} — ${text}`)
  }

  const data = await response.json()
  if (!data.device_code) {
    throw new Error(`Device authorization failed: ${data.error || 'Unknown error'} — ${data.error_description || 'No details'}`)
  }

  return data as QwenDeviceCodeResponse
}

/**
 * Step 2: Poll for token until user completes auth or timeout.
 */
async function pollForToken(
  deviceCode: string,
  codeVerifier: string,
  expiresInSeconds: number,
  onProgress?: (message: string) => void,
): Promise<QwenCredentials> {
  const pollInterval = 2000 // 2s base
  const maxAttempts = Math.ceil(expiresInSeconds / (pollInterval / 1000))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const body = objectToUrlEncoded({
      grant_type: QWEN_OAUTH_GRANT_TYPE,
      client_id: QWEN_OAUTH_CLIENT_ID,
      device_code: deviceCode,
      code_verifier: codeVerifier,
    })

    try {
      const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body,
      })

      const text = await response.text()
      let data: Record<string, unknown>
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Token poll failed: ${response.status} — ${text}`)
      }

      // authorization_pending — keep polling
      if (response.status === 400 && data.error === 'authorization_pending') {
        onProgress?.(`Waiting for authorization... (${attempt + 1}/${maxAttempts})`)
        await new Promise((r) => setTimeout(r, pollInterval))
        continue
      }

      // slow_down — increase interval
      if (response.status === 429 && data.error === 'slow_down') {
        onProgress?.('Server requested slowdown, waiting longer...')
        await new Promise((r) => setTimeout(r, Math.min(pollInterval * 1.5, 10000)))
        continue
      }

      // Success
      if (response.ok && data.access_token) {
        return {
          access_token: data.access_token as string,
          refresh_token: (data.refresh_token as string) || undefined,
          token_type: (data.token_type as string) || 'Bearer',
          resource_url: (data.resource_url as string) || undefined,
          expiry_date: data.expires_in
            ? Date.now() + (data.expires_in as number) * 1000
            : undefined,
        }
      }

      // Other error
      throw new Error(`Token poll failed: ${data.error || 'Unknown error'} — ${data.error_description || text}`)
    } catch (error: any) {
      // Network errors — retry
      if (error.message?.includes('fetch')) {
        onProgress?.(`Network error, retrying... (${error.message})`)
        await new Promise((r) => setTimeout(r, pollInterval))
        continue
      }
      throw error
    }
  }

  throw new Error('Authorization timed out. Please try again.')
}

/**
 * Step 3: Save credentials to ~/.claude/qwen-oauth.json
 */
function saveCredentials(credentials: QwenCredentials): void {
  mkdirSync(CLAUDE_DIR, { recursive: true })
  writeFileSync(
    QWEN_CREDENTIALS_PATH,
    JSON.stringify(credentials, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )
}

// ============================================================
// Public API
// ============================================================

export type QwenAuthProgress = {
  status: 'device_code' | 'browser' | 'polling' | 'success' | 'error' | 'timeout'
  message: string
  userCode?: string
  verificationUrl?: string
  verificationUrlComplete?: string
}

/**
 * Full device code flow:
 * 1. Generate PKCE
 * 2. Request device code
 * 3. Open browser
 * 4. Poll for token
 * 5. Save credentials
 *
 * Returns credentials on success, throws on failure.
 */
export async function authenticateWithQwenOAuth(
  onProgress?: (progress: QwenAuthProgress) => void,
): Promise<QwenCredentials> {
  try {
    // Step 1: Generate PKCE
    const { code_verifier, code_challenge } = generatePKCEPair()

    // Step 2: Request device code
    onProgress?.({ status: 'device_code', message: 'Requesting authorization from Qwen...' })
    const deviceCode = await requestDeviceCode(code_challenge)

    onProgress?.({
      status: 'browser',
      message: 'Opening browser for authentication...',
      userCode: deviceCode.user_code,
      verificationUrl: deviceCode.verification_uri,
      verificationUrlComplete: deviceCode.verification_uri_complete,
    })

    // Step 3: Open browser
    if (deviceCode.verification_uri_complete) {
      await openBrowser(deviceCode.verification_uri_complete)
    }

    // Step 4: Poll for token
    onProgress?.({
      status: 'polling',
      message: `Waiting for authentication... Your code: ${deviceCode.user_code}`,
      userCode: deviceCode.user_code,
    })

    const credentials = await pollForToken(
      deviceCode.device_code,
      code_verifier,
      deviceCode.expires_in,
      (msg) => onProgress?.({ status: 'polling', message: msg }),
    )

    // Step 5: Save credentials
    saveCredentials(credentials)

    onProgress?.({
      status: 'success',
      message: 'Authentication successful! Qwen Coder is ready to use.',
    })

    return credentials
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    onProgress?.({ status: 'error', message: `Authentication failed: ${message}` })
    throw error
  }
}

/**
 * Check if Qwen OAuth credentials exist and are valid.
 */
export function hasValidQwenCredentials(): boolean {
  if (!existsSync(QWEN_CREDENTIALS_PATH)) return false
  try {
    const raw = require('fs').readFileSync(QWEN_CREDENTIALS_PATH, 'utf8')
    const creds = JSON.parse(raw) as QwenCredentials
    if (!creds.access_token || !creds.expiry_date) return false
    return Date.now() < creds.expiry_date - 30000 // 30s buffer
  } catch {
    return false
  }
}

/**
 * Get current Qwen credentials (without refresh).
 */
export function getQwenCredentials(): QwenCredentials | null {
  if (!existsSync(QWEN_CREDENTIALS_PATH)) return null
  try {
    const raw = require('fs').readFileSync(QWEN_CREDENTIALS_PATH, 'utf8')
    return JSON.parse(raw) as QwenCredentials
  } catch {
    return null
  }
}
