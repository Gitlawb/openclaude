/**
 * Config for the local-remote server: port/host/token persistence.
 *
 * Stored under `localRemote` in the global config (see src/utils/config.ts).
 * Token is generated lazily on first `/remote on` if absent.
 */

import { randomBytes } from 'crypto'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'

export const DEFAULT_PORT = 7842
export const DEFAULT_HOST = '0.0.0.0'

export type LocalRemoteSettings = {
  port: number
  host: string
  token: string
  autoStart: boolean
}

function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Read effective settings, generating and persisting a token if missing.
 * Always returns a usable config — never throws.
 */
export function loadLocalRemoteSettings(): LocalRemoteSettings {
  const config = getGlobalConfig()
  const stored = config.localRemote

  let token = stored?.token
  let persisted = false
  if (!token) {
    token = generateToken()
    persisted = true
  }

  const settings: LocalRemoteSettings = {
    port: stored?.port ?? DEFAULT_PORT,
    host: stored?.host ?? DEFAULT_HOST,
    token,
    autoStart: stored?.autoStart ?? false,
  }

  if (persisted) {
    saveGlobalConfig(current => ({
      ...current,
      localRemote: {
        ...(current.localRemote ?? {}),
        token: settings.token,
      },
    }))
  }

  return settings
}

/** Rotate the bearer token and persist. Returns the new token. */
export function rotateLocalRemoteToken(): string {
  const newToken = generateToken()
  saveGlobalConfig(current => ({
    ...current,
    localRemote: {
      ...(current.localRemote ?? {}),
      token: newToken,
    },
  }))
  return newToken
}

/** Short token preview for user-facing status output. */
export function tokenPreview(token: string): string {
  if (token.length <= 10) return token
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}
