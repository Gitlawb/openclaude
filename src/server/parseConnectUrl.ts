/**
 * Parse `cc://` / `cc+unix://` connect URLs (DIRECT_CONNECT-gated).
 *
 * `claude cc://host:port?token=...` connects the REPL (or the headless
 * `open` subcommand) to a direct-connect server. The URL carries the
 * server location plus an optional auth token:
 *
 *   cc://host:port[/path][?token=...]      → http://host:port[/path]
 *   cc+unix:///path/to.sock[?token=...]    → http+unix:///path/to.sock
 *
 * The returned serverUrl is the HTTP base used by
 * createDirectConnectSession (`${serverUrl}/sessions`).
 */

export type ParsedConnectUrl = {
  /** HTTP base URL of the direct-connect server (no trailing slash). */
  serverUrl: string
  /** Bearer token for the server, when the URL carries one. */
  authToken?: string
}

export function parseConnectUrl(ccUrl: string): ParsedConnectUrl {
  let url: URL
  try {
    url = new URL(ccUrl)
  } catch {
    throw new Error(`Invalid connect URL: ${ccUrl}`)
  }

  const protocol = url.protocol
  if (protocol !== 'cc:' && protocol !== 'cc+unix:') {
    throw new Error(
      `Unsupported connect URL scheme '${protocol}' — expected cc:// or cc+unix://`,
    )
  }

  // Token: ?token=... query param, falling back to URL userinfo
  // (cc://token@host:port).
  const authToken =
    url.searchParams.get('token') || url.password || url.username || undefined
  url.searchParams.delete('token')

  const scheme = protocol === 'cc+unix:' ? 'http+unix' : 'http'
  const pathname = url.pathname.replace(/\/+$/, '')
  const serverUrl = `${scheme}://${url.host}${pathname}${url.search}`

  return {
    serverUrl,
    ...(authToken && { authToken }),
  }
}
