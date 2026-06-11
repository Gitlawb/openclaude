/**
 * Inert stub for the OpenClaude session-server logger.
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `createServerLogger` returns a
 * logger that discards every message. No import-time side effects.
 */

/** Sink for server log lines. The stub discards all messages. */
export type ServerLogger = (message: string) => void

export function createServerLogger(): ServerLogger {
  return () => {}
}
