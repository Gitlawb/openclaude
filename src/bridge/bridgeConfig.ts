/**
 * Shared bridge auth/URL resolution for openclaude.
 *
 * The bridge target follows the active LLM provider:
 * - Anthropic (OAuth or API key via api.anthropic.com) → Anthropic bridge
 *   (`https://api.anthropic.com`), authenticated with the user's OAuth
 *   tokens. This is the only path where the Anthropic bridge endpoints
 *   accept our credentials.
 * - Any non-Anthropic provider (OpenAI, Gemini, Ollama, Bedrock, Vertex…)
 *   → local bridge server (`packages/bridge-server/`) at `localhost:4080`,
 *   authenticated with the `'openclaude-local-bridge'` token.
 *
 * Explicit `CLAUDE_BRIDGE_*` env overrides take precedence in both layers.
 */

import { getOauthConfig } from '../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../utils/auth.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../utils/model/providers.js'

/**
 * Is the active LLM provider Anthropic's first-party API?
 *
 * Returns true for OAuth login OR direct ANTHROPIC_API_KEY against
 * api.anthropic.com. Returns false for bedrock/vertex (Anthropic models
 * routed via AWS/GCP auth, not compatible with the Anthropic bridge) and
 * for any third-party provider.
 */
function isAnthropicProvider(): boolean {
  return getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
}

/** Dev override: CLAUDE_BRIDGE_OAUTH_TOKEN, else undefined. */
export function getBridgeTokenOverride(): string | undefined {
  return process.env.CLAUDE_BRIDGE_OAUTH_TOKEN || undefined
}

/** Dev override: CLAUDE_BRIDGE_BASE_URL, else undefined. */
export function getBridgeBaseUrlOverride(): string | undefined {
  return process.env.CLAUDE_BRIDGE_BASE_URL || undefined
}

/**
 * Access token for bridge API calls:
 * - Override `CLAUDE_BRIDGE_OAUTH_TOKEN` wins.
 * - Anthropic provider → OAuth access token from the keychain (required by
 *   the Anthropic bridge endpoints).
 * - Otherwise → `'openclaude-local-bridge'` static token accepted by the
 *   local bridge server.
 */
export function getBridgeAccessToken(): string | undefined {
  const override = getBridgeTokenOverride()
  if (override) return override
  if (isAnthropicProvider()) {
    return getClaudeAIOAuthTokens()?.accessToken
  }
  return 'openclaude-local-bridge'
}

/**
 * Base URL for bridge API calls:
 * - Override `CLAUDE_BRIDGE_BASE_URL` wins.
 * - Anthropic provider → the OAuth config's `BASE_API_URL` (prod/staging).
 * - Otherwise → the local bridge server at `http://localhost:4080`.
 *
 * When the non-Anthropic path targets localhost but the local bridge
 * server is not running, session creation fails with ECONNREFUSED — see
 * codeSessionApi.ts for the user-facing error message.
 */
export function getBridgeBaseUrl(): string {
  const override = getBridgeBaseUrlOverride()
  if (override) return override
  if (isAnthropicProvider()) {
    return getOauthConfig().BASE_API_URL
  }
  return 'http://localhost:4080'
}
