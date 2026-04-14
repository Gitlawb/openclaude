/**
 * Qwen OAuth credentials management.
 *
 * Saves/reads credentials as a JSON file at ~/.claude/qwen-oauth.json
 * (same approach as the Qwen Code CLI, which uses ~/.qwen/oauth_creds.json).
 *
 * No secureStorage dependency — file permissions are set to 0o600 (owner-only).
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================
// Constants
// ============================================================

const CREDENTIALS_DIR = join(homedir(), '.claude')
const CREDENTIALS_FILE = 'qwen-oauth.json'
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, CREDENTIALS_FILE)

export interface QwenStoredCredentials {
  accessToken: string
  refreshToken: string
  resourceUrl: string
  expiryDate: number
  accountId: string
  lastRefreshAt: number
  lastRefreshFailureAt?: number
}

// ============================================================
// File-based credential storage
// ============================================================

/**
 * Save Qwen credentials to ~/.claude/qwen-oauth.json.
 * Overwrites any existing credentials file.
 * Returns true on success.
 */
export async function saveQwenCredentials(creds: QwenStoredCredentials): Promise<boolean> {
  try {
    mkdirSync(CREDENTIALS_DIR, { recursive: true })
    writeFileSync(
      CREDENTIALS_PATH,
      JSON.stringify(creds, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
    return true
  } catch {
    return false
  }
}

/**
 * Read Qwen credentials from ~/.claude/qwen-oauth.json.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function readQwenCredentials(): Promise<QwenStoredCredentials | null> {
  try {
    if (!existsSync(CREDENTIALS_PATH)) return null
    const raw = readFileSync(CREDENTIALS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.accessToken) {
      return parsed as QwenStoredCredentials
    }
    return null
  } catch {
    return null
  }
}

/**
 * Check if valid Qwen credentials exist (not expired, 30s buffer).
 */
export async function hasStoredQwenCredentials(): Promise<boolean> {
  const creds = await readQwenCredentials()
  if (!creds) return false
  return Date.now() < creds.expiryDate - 30_000
}

/**
 * Clear Qwen credentials by deleting the file.
 */
export async function clearQwenCredentials(): Promise<boolean> {
  try {
    if (!existsSync(CREDENTIALS_PATH)) return true
    const fs = await import('node:fs/promises')
    await fs.unlink(CREDENTIALS_PATH)
    return true
  } catch {
    return false
  }
}
