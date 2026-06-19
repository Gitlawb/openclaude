/**
 * Inert stub for the headless direct-connect runner (`claude open <url> -p`).
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `runConnectHeadless` resolves
 * immediately without attaching to the session, so the command exits quietly
 * after session creation — the same observable behavior as the `() => null`
 * bundler stub. No import-time side effects.
 */

import type { DirectConnectConfig } from './directConnectManager.js'

export async function runConnectHeadless(
  _config: DirectConnectConfig,
  _prompt: string,
  _outputFormat: string,
  _interactive: boolean,
): Promise<void> {}
