/**
 * Inert stub for the OpenClaude session-server startup banner.
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `printBanner` prints nothing —
 * with the stubbed `startServer` no server is actually listening, so
 * advertising a connect URL would be misleading. No import-time side effects.
 */

import type { ServerConfig } from './server.js'

export function printBanner(
  _config: ServerConfig,
  _authToken: string,
  _port: number,
): void {}
