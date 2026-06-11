/**
 * Inert stub for the UDS (Unix domain socket) messaging server.
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where `feature('UDS_INBOX')` is
 * disabled. This module preserves that behavior: no socket is created,
 * no environment variables are exported, and no import-time side effects
 * occur.
 */

import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Default socket path used when no `--messaging-socket-path` is passed.
 * Pure computation — no filesystem access.
 */
export function getDefaultUdsSocketPath(): string {
  return join(tmpdir(), `claude-messaging-${process.pid}.sock`)
}

/**
 * Start the UDS messaging server. Inert: resolves immediately without
 * binding a socket or exporting $CLAUDE_CODE_MESSAGING_SOCKET.
 */
export async function startUdsMessaging(
  _socketPath: string,
  _options: { isExplicit: boolean },
): Promise<void> {
  // no-op
}

/**
 * Socket path of the running UDS messaging server, if any.
 * Inert: no server is ever started, so this is always undefined.
 */
export function getUdsMessagingSocketPath(): string | undefined {
  return undefined
}

/**
 * Register a callback fired when a message is enqueued via the UDS socket.
 * Inert: no socket exists, so the callback is never invoked.
 */
export function setOnEnqueue(_callback: () => void): void {
  // no-op
}
