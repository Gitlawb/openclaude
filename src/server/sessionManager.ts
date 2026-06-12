/**
 * Inert stub for the OpenClaude session-server session manager.
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. The manager tracks nothing and
 * `destroyAll` resolves immediately. No import-time side effects.
 */

export type SessionManagerOptions = {
  /** Idle timeout for detached sessions in ms (0 = never expire). */
  idleTimeoutMs: number
  /** Maximum concurrent sessions (0 = unlimited). */
  maxSessions: number
}

export class SessionManager {
  constructor(_backend: unknown, _options: SessionManagerOptions) {}

  /** Tear down all sessions. Stub: nothing to destroy, resolves immediately. */
  async destroyAll(): Promise<void> {}
}
