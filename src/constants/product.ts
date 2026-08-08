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
 * Hostname of the staging remote-session ingress/API. This is the default
 * `sessionIngressUrl` host in staging builds: both bridge entry points fall
 * back to `getBridgeBaseUrl()` (`https://api-staging.anthropic.com`) when
 * `CLAUDE_BRIDGE_SESSION_INGRESS_URL` is unset — see src/constants/oauth.ts
 * and src/bridge/bridgeMain.ts. It carries no bare `staging` dot-label, so a
 * generic label match would miss it.
 */
const STAGING_INGRESS_HOSTNAME = 'api-staging.anthropic.com'

/**
 * Dot-anchored suffix of the staging zone (`claude-ai.staging.ant.dev`,
 * `platform.staging.ant.dev`, …). Anchored on a leading `.` so it matches a
 * subdomain of the zone but never an unrelated host that merely embeds the
 * label, e.g. `foo.staging.example.com`.
 */
const STAGING_INGRESS_HOST_SUFFIX = '.staging.ant.dev'

/**
 * Determine if we're in a staging environment for remote sessions.
 * Checks session ID format and ingress URL.
 *
 * The ingress URL is matched against an explicit allowlist of the real staging
 * ingress/API hosts (exact `api-staging.anthropic.com`, or a subdomain of the
 * `.staging.ant.dev` zone) rather than a raw substring or a generic `staging`
 * label. A bare label match both *missed* the real `api-staging.anthropic.com`
 * ingress (no `staging` label) and *over-matched* unrelated hosts such as
 * `foo.staging.example.com`; the allowlist is correct in both directions.
 */
export function isRemoteSessionStaging(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  if (sessionId?.includes('_staging_') === true) {
    return true
  }
  const hostname = getIngressHostname(ingressUrl)
  if (hostname === undefined) {
    return false
  }
  return (
    hostname === STAGING_INGRESS_HOSTNAME ||
    hostname.endsWith(STAGING_INGRESS_HOST_SUFFIX)
  )
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
