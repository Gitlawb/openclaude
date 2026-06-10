/**
 * Inert stub for the OpenClaude session-server HTTP listener.
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `startServer` binds nothing and
 * returns a handle whose `port` is undefined and whose `stop` is a no-op, so
 * `claude server` exits without ever listening. The call site in main.tsx
 * does not catch action errors (bare `program.parseAsync`), so a no-op is
 * preferred over throwing. No import-time side effects.
 */

import type { SessionManager } from './sessionManager.js'
import type { ServerLogger } from './serverLog.js'

export type ServerConfig = {
  port: number
  host: string
  authToken: string
  unix: string | undefined
  workspace: string | undefined
  idleTimeoutMs: number
  maxSessions: number
}

export type ServerHandle = {
  /** Actual bound port. Stub: undefined (nothing is listening). */
  port: number | undefined
  /** Stop accepting connections. Stub: no-op. */
  stop: (closeActiveConnections?: boolean) => void
}

export function startServer(
  _config: ServerConfig,
  _sessionManager: SessionManager,
  _logger: ServerLogger,
): ServerHandle {
  return {
    port: undefined,
    stop: () => {},
  }
}
