import axios from 'axios'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import type { WorkSecret } from './types.js'

/** Decode a base64url-encoded work secret and validate its version. */
export function decodeWorkSecret(secret: string): WorkSecret {
  const json = Buffer.from(secret, 'base64url').toString('utf-8')
  const parsed: unknown = jsonParse(json)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    parsed.version !== 1
  ) {
    throw new Error(
      `Unsupported work secret version: ${parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : 'unknown'}`,
    )
  }
  const obj = parsed as Record<string, unknown>
  if (
    typeof obj.session_ingress_token !== 'string' ||
    obj.session_ingress_token.length === 0
  ) {
    throw new Error(
      'Invalid work secret: missing or empty session_ingress_token',
    )
  }
  if (typeof obj.api_base_url !== 'string') {
    throw new Error('Invalid work secret: missing api_base_url')
  }
  return parsed as WorkSecret
}

/**
 * Whether a base URL points at the local loopback interface.
 *
 * Parses the URL and matches the hostname component exactly. Substring checks
 * like `url.includes('localhost')` are unsafe here: a remote host such as
 * `http://evil.localhost.com` or `http://evil.com/localhost` contains the
 * literal text without being loopback, so a substring guard would wrongly
 * treat it as local. A malformed URL is treated as non-local (the safe default
 * for the HTTPS-enforcement callers below).
 */
export function isLocalhostBaseUrl(baseUrl: string): boolean {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname
  } catch {
    return false
  }
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * Whether a base URL would send traffic to a non-localhost host over plaintext
 * HTTP, which must be rejected to keep credentials off the wire.
 *
 * The scheme is read from the parsed URL (`protocol === 'http:'`) rather than a
 * `startsWith('http://')` test so that mixed-case schemes like `HTTP://` — which
 * the URL parser normalizes to `http:` and would otherwise carry credentials in
 * the clear — are still caught. A malformed URL is treated as not-insecure (the
 * safe default: the callers fall through to their normal handling).
 */
export function isInsecureHttpBaseUrl(baseUrl: string): boolean {
  let protocol: string
  try {
    protocol = new URL(baseUrl).protocol
  } catch {
    return false
  }
  return protocol === 'http:' && !isLocalhostBaseUrl(baseUrl)
}

/**
 * Build a WebSocket SDK URL from the API base URL and session ID.
 * Strips the HTTP(S) protocol and constructs a ws(s):// ingress URL.
 *
 * Uses /v2/ for localhost (direct to session-ingress, no Envoy rewrite)
 * and /v1/ for production (Envoy rewrites /v1/ → /v2/).
 */
export function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const isLocalhost = isLocalhostBaseUrl(apiBaseUrl)
  const protocol = isLocalhost ? 'ws' : 'wss'
  const version = isLocalhost ? 'v2' : 'v1'
  const host = apiBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`
}

/**
 * Compare two session IDs regardless of their tagged-ID prefix.
 *
 * Tagged IDs have the form {tag}_{body} or {tag}_staging_{body}, where the
 * body encodes a UUID. CCR v2's compat layer returns `session_*` to v1 API
 * clients (compat/convert.go:41) but the infrastructure layer (sandbox-gateway
 * work queue, work poll response) uses `cse_*` (compat/CLAUDE.md:13). Both
 * have the same underlying UUID.
 *
 * Without this, replBridge rejects its own session as "foreign" at the
 * work-received check when the ccr_v2_compat_enabled gate is on.
 */
export function sameSessionId(a: string, b: string): boolean {
  if (a === b) return true
  // The body is everything after the last underscore — this handles both
  // `{tag}_{body}` and `{tag}_staging_{body}`.
  const aBody = a.slice(a.lastIndexOf('_') + 1)
  const bBody = b.slice(b.lastIndexOf('_') + 1)
  // Guard against IDs with no underscore (bare UUIDs): lastIndexOf returns -1,
  // slice(0) returns the whole string, and we already checked a === b above.
  // Require a minimum length to avoid accidental matches on short suffixes
  // (e.g. single-char tag remnants from malformed IDs).
  return aBody.length >= 4 && aBody === bBody
}

/**
 * Build a CCR v2 session URL from the API base URL and session ID.
 * Unlike buildSdkUrl, this returns an HTTP(S) URL (not ws://) and points at
 * /v1/code/sessions/{id} — the child CC will derive the SSE stream path
 * and worker endpoints from this base.
 */
export function buildCCRv2SdkUrl(
  apiBaseUrl: string,
  sessionId: string,
): string {
  const base = apiBaseUrl.replace(/\/+$/, '')
  return `${base}/v1/code/sessions/${sessionId}`
}

/**
 * Register this bridge as the worker for a CCR v2 session.
 * Returns the worker_epoch, which must be passed to the child CC process
 * so its CCRClient can include it in every heartbeat/state/event request.
 *
 * Mirrors what environment-manager does in the container path
 * (api-go/environment-manager/cmd/cmd_task_run.go RegisterWorker).
 */
export async function registerWorker(
  sessionUrl: string,
  accessToken: string,
): Promise<number> {
  const response = await axios.post(
    `${sessionUrl}/worker/register`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      timeout: 10_000,
    },
  )
  // protojson serializes int64 as a string to avoid JS number precision loss;
  // the Go side may also return a number depending on encoder settings.
  const raw = response.data?.worker_epoch
  const epoch = typeof raw === 'string' ? Number(raw) : raw
  if (
    typeof epoch !== 'number' ||
    !Number.isFinite(epoch) ||
    !Number.isSafeInteger(epoch)
  ) {
    throw new Error(
      `registerWorker: invalid worker_epoch in response: ${jsonStringify(response.data)}`,
    )
  }
  return epoch
}
