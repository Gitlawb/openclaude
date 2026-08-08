import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

/**
 * Common interface for session-ingress transports.
 *
 * Implemented by:
 * - WebSocketTransport (WS reads + WS writes) — default
 * - HybridTransport (WS reads + HTTP POST writes)
 * - SSETransport (SSE reads + HTTP POST writes) — CCR v2
 *
 * Consumers (e.g. remoteIO) program against this interface and obtain a
 * concrete instance via getTransportForUrl().
 */
export interface Transport {
  /**
   * Open the transport connection. Implementations handle their own
   * reconnection/backoff; the returned promise resolves when the initial
   * connection attempt completes (or the transport gives up).
   */
  connect(): Promise<void> | void

  /** Send a message to the server. */
  write(message: StdoutMessage): Promise<void> | void

  /** Permanently close the transport, allowing async flush/cleanup. */
  close(): Promise<void> | void

  /** Register the callback invoked with newline-delimited JSON payloads. */
  setOnData(callback: (data: string) => void): void

  /**
   * Register the callback invoked when the transport closes permanently.
   * `closeCode` is the WS close code or HTTP status, when available.
   */
  setOnClose(callback: (closeCode?: number) => void): void

  /** Register the callback invoked when the transport connects. */
  setOnConnect?(callback: () => void): void

  /** Register the callback invoked for transport-specific events. */
  setOnEvent?(callback: (event: unknown) => void): void

  /** Whether the transport is currently connected. */
  isConnectedStatus?(): boolean

  /** Whether the transport has permanently closed. */
  isClosedStatus?(): boolean

  /** Human-readable transport state for diagnostics. */
  getStateLabel?(): string
}
