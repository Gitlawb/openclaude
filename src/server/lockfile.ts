/**
 * Inert stub for the OpenClaude session-server lockfile.
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `probeRunningServer` reports no
 * running server (null) so gated callers proceed; write/remove touch no
 * files. No import-time side effects.
 */

export type ServerLockInfo = {
  pid: number
  port: number
  host: string
  httpUrl: string
  startedAt: number
}

export async function writeServerLock(_info: ServerLockInfo): Promise<void> {}

export async function removeServerLock(): Promise<void> {}

/** Stub: no lockfile is ever written, so no running server is ever found. */
export async function probeRunningServer(): Promise<ServerLockInfo | null> {
  return null
}
