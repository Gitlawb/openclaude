/**
 * Inert stub for the UDS (Unix domain socket) messaging client.
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where the relevant features
 * (`UDS_INBOX`, `BG_SESSIONS`) are disabled. This module preserves that
 * behavior: no sockets are contacted and no import-time side effects occur.
 */

/** A live session discovered via its UDS messaging socket. */
export type LiveSession = {
  sessionId?: string
  /** Session kind, e.g. 'interactive', or a background/daemon variant. */
  kind?: string
}

/**
 * List all live sessions advertising a UDS messaging socket.
 * Inert: no sockets are probed; always resolves to an empty list.
 */
export async function listAllLiveSessions(): Promise<LiveSession[]> {
  return []
}

/**
 * Send a message to a session's UDS messaging socket.
 * Inert: delivery is impossible without the real client, so this always
 * rejects. Callers handle the failure (SendMessageTool wraps it in a
 * try/catch and reports the send as failed).
 */
export async function sendToUdsSocket(
  _socketPath: string,
  _message: string,
): Promise<void> {
  throw new Error('UDS messaging is unavailable in this build')
}
