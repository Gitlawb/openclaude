/**
 * Shared bridge auth/URL resolution. Consolidates the CLAUDE_BRIDGE_*
 * dev overrides that were previously copy-pasted across a dozen files —
 * inboundAttachments, BriefTool/upload, bridgeMain, initReplBridge,
 * remoteBridgeCore, daemon workers, /rename, /remote-control.
 *
 * Two layers: *Override() returns the dev env var (or undefined);
 * the non-Override versions fall through to the real OAuth store/config.
 * Callers that compose with a different auth source (e.g. daemon workers
 * using IPC auth) use the Override getters directly.
 */

import { getOauthConfig } from '../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../utils/auth.js'

/** Dev override: CLAUDE_BRIDGE_OAUTH_TOKEN, else undefined. */
export function getBridgeTokenOverride(): string | undefined {
  return process.env.CLAUDE_BRIDGE_OAUTH_TOKEN || undefined
}

/** Dev override: CLAUDE_BRIDGE_BASE_URL, else undefined. */
export function getBridgeBaseUrlOverride(): string | undefined {
  return process.env.CLAUDE_BRIDGE_BASE_URL || undefined
}

/**
 * Access token for bridge API calls: env override first, then OAuth
 * keychain, then local bridge default token.
 */
export function getBridgeAccessToken(): string | undefined {
  return (
    getBridgeTokenOverride() ??
    getClaudeAIOAuthTokens()?.accessToken ??
    'openclaude-local-bridge'
  )
}

/**
 * Base URL for bridge API calls: env override first, then OAuth config,
 * then localhost default for the local bridge server.
 */
export function getBridgeBaseUrl(): string {
  return (
    getBridgeBaseUrlOverride() ??
    getOauthConfig()?.BASE_API_URL ??
    'http://localhost:4080'
  )
}
