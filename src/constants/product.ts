export const PRODUCT_DISPLAY_NAME = 'OpenClaude'
export const PRODUCT_URL = 'https://claude.com/claude-code'

// Claude Code Remote session URLs
export const CLAUDE_AI_BASE_URL = 'https://claude.ai'
export const CLAUDE_AI_STAGING_BASE_URL = 'https://claude-ai.staging.ant.dev'
export const CLAUDE_AI_LOCAL_BASE_URL = 'http://localhost:4000'

/**
 * Parse the hostname from an ingress URL, lowercased. Returns undefined for a
 * missing or malformed URL so callers can treat it as "no match" rather than
 * matching on arbitrary substrings of the raw string.
 *
 * Inlined (rather than reusing src/bridge helpers) to keep constants/ a leaf of
 * the module-load DAG.
 */
function getIngressHostname(ingressUrl?: string): string | undefined {
  if (!ingressUrl) {
    return undefined
  }
  try {
    return new URL(ingressUrl).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Determine if we're in a staging environment for remote sessions.
 * Checks session ID format and ingress URL.
 *
 * The ingress URL is matched on a hostname *label* (`...staging...` as a
 * dot-delimited segment, e.g. `claude-ai.staging.ant.dev`) rather than a raw
 * substring, so a production URL that merely carries `staging` in its path or
 * query (e.g. `https://claude.ai/code/x?ref=staging`) is not misrouted to the
 * staging endpoint.
 */
export function isRemoteSessionStaging(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  if (sessionId?.includes('_staging_') === true) {
    return true
  }
  const hostname = getIngressHostname(ingressUrl)
  return hostname !== undefined && hostname.split('.').includes('staging')
}

/**
 * Determine if we're in a local-dev environment for remote sessions.
 * Checks session ID format (e.g. `session_local_...`) and ingress URL.
 *
 * The ingress URL is matched on an exact localhost hostname (mirroring
 * `isLocalhostBaseUrl` in src/bridge/workSecret.ts) rather than a raw
 * substring, so a production URL that merely carries `localhost` in its path or
 * query is not misrouted to the local-dev endpoint.
 */
export function isRemoteSessionLocal(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  if (sessionId?.includes('_local_') === true) {
    return true
  }
  const hostname = getIngressHostname(ingressUrl)
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * Get the base URL for Claude AI based on environment.
 */
export function getClaudeAiBaseUrl(
  sessionId?: string,
  ingressUrl?: string,
): string {
  if (isRemoteSessionLocal(sessionId, ingressUrl)) {
    return CLAUDE_AI_LOCAL_BASE_URL
  }
  if (isRemoteSessionStaging(sessionId, ingressUrl)) {
    return CLAUDE_AI_STAGING_BASE_URL
  }
  return CLAUDE_AI_BASE_URL
}

/**
 * Get the full session URL for a remote session.
 *
 * The cse_→session_ translation is a temporary shim gated by
 * tengu_bridge_repl_v2_cse_shim_enabled (see isCseShimEnabled). Worker
 * endpoints (/v1/code/sessions/{id}/worker/*) want `cse_*` but the claude.ai
 * frontend currently routes on `session_*` (compat/convert.go:27 validates
 * TagSession). Same UUID body, different tag prefix. Once the server tags by
 * environment_kind and the frontend accepts `cse_*` directly, flip the gate
 * off. No-op for IDs already in `session_*` form. See toCompatSessionId in
 * src/bridge/sessionIdCompat.ts for the canonical helper (lazy-required here
 * to keep constants/ leaf-of-DAG at module-load time).
 */
export function getRemoteSessionUrl(
  sessionId: string,
  ingressUrl?: string,
): string {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { toCompatSessionId } =
    require('../bridge/sessionIdCompat.js') as typeof import('../bridge/sessionIdCompat.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const compatId = toCompatSessionId(sessionId)
  const baseUrl = getClaudeAiBaseUrl(compatId, ingressUrl)
  return `${baseUrl}/code/${compatId}`
}
