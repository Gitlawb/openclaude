/**
 * Persistent credentials for the Qwen OAuth provider.
 *
 * Stored at ~/.qwen/oauth_creds.json for compatibility with the qwen-code CLI
 * — either tool can refresh tokens written by the other.
 *
 *   { access_token, refresh_token, token_type, resource_url, expires_at }
 *
 * `expires_at` is milliseconds since the Unix epoch (the qwen-code CLI's
 * convention). We refresh 30s before that boundary.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { isBareMode, isEnvTruthy } from './envUtils.js'
import {
  refreshQwenToken,
  resolveQwenBaseUrl,
  QWEN_DEFAULT_RESOURCE_URL,
  QwenDeviceFlowError,
  type QwenTokenResponse,
} from '../services/qwen/deviceFlow.js'

const REFRESH_LEEWAY_MS = 30_000

export type QwenCredentials = {
  access_token: string
  refresh_token: string
  token_type: string
  resource_url?: string
  /** Milliseconds since epoch. */
  expires_at: number
}

export function getQwenCredentialsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.QWEN_OAUTH_CREDS_PATH?.trim()
  if (override) return override
  const qwenHome = env.QWEN_HOME?.trim() || join(homedir(), '.qwen')
  return join(qwenHome, 'oauth_creds.json')
}

export function loadQwenCredentials(
  path = getQwenCredentialsPath(),
): QwenCredentials | undefined {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<QwenCredentials> | undefined
    if (
      !parsed ||
      typeof parsed.access_token !== 'string' ||
      typeof parsed.refresh_token !== 'string' ||
      typeof parsed.expires_at !== 'number'
    ) {
      return undefined
    }
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      token_type:
        typeof parsed.token_type === 'string' ? parsed.token_type : 'Bearer',
      resource_url:
        typeof parsed.resource_url === 'string' ? parsed.resource_url : undefined,
      expires_at: parsed.expires_at,
    }
  } catch {
    return undefined
  }
}

export function saveQwenCredentials(
  creds: QwenCredentials,
  path = getQwenCredentialsPath(),
): { success: boolean; warning?: string } {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 })
    return { success: true }
  } catch (err) {
    return {
      success: false,
      warning: err instanceof Error ? err.message : String(err),
    }
  }
}

export function fromTokenResponse(
  response: QwenTokenResponse,
  now: number = Date.now(),
): QwenCredentials {
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    token_type: response.token_type || 'Bearer',
    resource_url: response.resource_url,
    expires_at: now + response.expires_in * 1000,
  }
}

export type ResolvedQwenCredential =
  | { kind: 'none' }
  | { kind: 'token'; accessToken: string; baseUrl: string }

/**
 * Returns a usable access token, refreshing on-the-fly if within the leeway
 * window. Persists refreshed credentials back to disk.
 */
export async function resolveQwenCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedQwenCredential> {
  const path = getQwenCredentialsPath(env)
  const current = loadQwenCredentials(path)
  if (!current) return { kind: 'none' }

  if (Date.now() < current.expires_at - REFRESH_LEEWAY_MS) {
    return {
      kind: 'token',
      accessToken: current.access_token,
      baseUrl: resolveQwenBaseUrl(current.resource_url),
    }
  }

  try {
    const refreshed = await refreshQwenToken(current.refresh_token)
    const next: QwenCredentials = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_type: refreshed.token_type || current.token_type,
      resource_url: refreshed.resource_url ?? current.resource_url,
      expires_at: Date.now() + refreshed.expires_in * 1000,
    }
    saveQwenCredentials(next, path)
    return {
      kind: 'token',
      accessToken: next.access_token,
      baseUrl: resolveQwenBaseUrl(next.resource_url),
    }
  } catch (err) {
    if (err instanceof QwenDeviceFlowError) {
      return { kind: 'none' }
    }
    throw err
  }
}

/** Synchronous, non-refreshing lookup — used by early env hydration. */
export function readQwenAccessTokenSync(
  env: NodeJS.ProcessEnv = process.env,
): { accessToken: string; baseUrl: string } | undefined {
  const current = loadQwenCredentials(getQwenCredentialsPath(env))
  if (!current) return undefined
  if (Date.now() >= current.expires_at) return undefined
  return {
    accessToken: current.access_token,
    baseUrl: resolveQwenBaseUrl(current.resource_url),
  }
}

/**
 * If Qwen mode is on, copy the stored access token into OPENAI_* env vars so
 * downstream OpenAI-shim code picks it up. Mirrors
 * `hydrateGeminiAccessTokenFromSecureStorage` in `geminiCredentials.ts`.
 */
export function hydrateQwenCredentialsFromDisk(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isEnvTruthy(env.CLAUDE_CODE_USE_QWEN)) return
  if (isBareMode()) return
  const creds = readQwenAccessTokenSync(env)
  if (!creds) return
  // Always overwrite: tokens are short-lived, the disk copy is authoritative.
  env.OPENAI_API_KEY = creds.accessToken
  env.OPENAI_BASE_URL ??= creds.baseUrl
  env.OPENAI_MODEL ??= 'qwen3-coder-plus'
}

export const QWEN_DEFAULT_BASE_URL = QWEN_DEFAULT_RESOURCE_URL
