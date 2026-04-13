/**
 * Shared bridge auth/URL resolution for openclaude.
 *
 * In this fork, the bridge is decoupled from the LLM provider: the bridge
 * target is always the local bridge server (`packages/bridge-server/`) at
 * `localhost:4080` unless an explicit `CLAUDE_BRIDGE_*` env override is
 * set. Having Anthropic OAuth tokens (for inference) does not redirect the
 * bridge to production — a user may run inference via Anthropic and remote
 * control via the local bridge.
 *
 * Two layers: *Override() returns the dev env var (or undefined); the
 * non-Override versions compose overrides with the local bridge defaults.
 */

/** Dev override: CLAUDE_BRIDGE_OAUTH_TOKEN, else undefined. */
export function getBridgeTokenOverride(): string | undefined {
  return process.env.CLAUDE_BRIDGE_OAUTH_TOKEN || undefined
}

/** Dev override: CLAUDE_BRIDGE_BASE_URL, else undefined. */
export function getBridgeBaseUrlOverride(): string | undefined {
  return process.env.CLAUDE_BRIDGE_BASE_URL || undefined
}

/**
 * Access token for bridge API calls: env override, then local bridge
 * default token.
 *
 * In this fork, the bridge auth is decoupled from the LLM provider — a
 * user's Anthropic OAuth tokens (for inference) are not valid credentials
 * for the local bridge server, which accepts only `'openclaude-local-bridge'`
 * or an explicit `CLAUDE_BRIDGE_OAUTH_TOKEN` override.
 */
export function getBridgeAccessToken(): string | undefined {
  return getBridgeTokenOverride() ?? 'openclaude-local-bridge'
}

/**
 * Base URL for bridge API calls: env override, then localhost default for
 * the local bridge server.
 *
 * In this fork (openclaude) the bridge is always local by default — it is
 * decoupled from the LLM provider. A user can have Anthropic OAuth tokens
 * for inference while still targeting the local bridge for remote control.
 * The local bridge server only accepts the `'openclaude-local-bridge'`
 * token (or `CLAUDE_BRIDGE_OAUTH_TOKEN` when set), so defaulting to the
 * Anthropic production API would break auth for logged-in users.
 *
 * Set `CLAUDE_BRIDGE_BASE_URL` to point to a non-local bridge.
 */
export function getBridgeBaseUrl(): string {
  return getBridgeBaseUrlOverride() ?? 'http://localhost:4080'
}
