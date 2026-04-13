/**
 * OpenClaude for Chrome MCP — Unix socket client
 *
 * Connects to the Chrome native host's Unix domain socket and provides
 * a request/response API for tool calls. The native host
 * (chromeNativeHost.ts) acts as a bridge between this socket client
 * and the Chrome extension via native messaging.
 *
 * Protocol: 4-byte little-endian length prefix + UTF-8 JSON payload.
 */

import { createConnection, type Socket } from 'net'
import type { ClaudeForChromeContext } from './types.js'
import type { ToolRequest, ToolResponse } from './protocol.js'

const CONNECTION_TIMEOUT_MS = 5_000
const TOOL_CALL_TIMEOUT_MS = 120_000
const MAX_MESSAGE_SIZE = 1024 * 1024 // 1 MB, matches chromeNativeHost.ts

type PendingRequest = {
  resolve: (value: ToolResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SocketClient {
  private socket: Socket | null = null
  private buffer: Buffer = Buffer.alloc(0)
  private pendingQueue: PendingRequest[] = []
  private connected = false
  private connectPromise: Promise<void> | null = null
  private context: ClaudeForChromeContext

  constructor(context: ClaudeForChromeContext) {
    this.context = context
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * Attempt to connect to the native host socket.
   * Tries the primary socketPath first, then scans getSocketPaths().
   * Concurrent callers share the same in-flight promise.
   */
  async connect(): Promise<void> {
    if (this.connected) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null
    })
    return this.connectPromise
  }

  private async doConnect(): Promise<void> {
    const candidates = [
      this.context.socketPath,
      ...this.context.getSocketPaths().filter(p => p !== this.context.socketPath),
    ]

    for (const socketPath of candidates) {
      try {
        await this.tryConnect(socketPath)
        this.context.logger.info(
          `[OpenClaude Chrome] Connected to native host socket: ${socketPath}`,
        )
        this.context.trackEvent('chrome_socket_connected')
        return
      } catch {
        // Socket not available, try next candidate
      }
    }

    // Throw so concurrent awaiters of connectPromise all get the same rejection
    // and a fresh connect() can be attempted on the next tool call.
    throw new Error(
      'Could not connect to any native host socket',
    )
  }

  private tryConnect(socketPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }

      const timer = setTimeout(() => {
        settle(() => {
          socket.destroy()
          reject(new Error(`Connection timeout: ${socketPath}`))
        })
      }, CONNECTION_TIMEOUT_MS)

      const socket = createConnection(socketPath, () => {
        settle(() => {
          // Remove connect-time listeners before installing persistent ones
          socket.removeAllListeners('error')
          socket.removeAllListeners('close')

          this.socket = socket
          this.connected = true
          this.buffer = Buffer.alloc(0)

          // Persistent handlers — only active after successful connection
          socket.on('data', (data: Buffer) => this.onData(data))
          socket.on('error', (err: Error) => {
            this.context.logger.debug(
              `[OpenClaude Chrome] Socket error: ${err.message}`,
            )
            this.handleDisconnect()
          })
          socket.on('close', () => {
            this.handleDisconnect()
          })

          resolve()
        })
      })

      // Connect-time listeners — only reject, never touch instance state
      socket.on('error', (err: Error) => {
        settle(() => reject(err))
      })
      socket.on('close', () => {
        settle(() => reject(new Error(`Socket closed during connect: ${socketPath}`)))
      })
    })
  }

  /**
   * Send a tool request and wait for the response.
   * Tool calls are sequential (one at a time from the LLM), so a simple
   * FIFO queue handles request/response correlation.
   */
  async sendToolRequest(
    method: string,
    params?: unknown,
  ): Promise<ToolResponse> {
    const socket = this.socket
    if (!socket || !this.connected) {
      throw new Error('Not connected to native host')
    }

    const request: ToolRequest = { method, params }
    const payload = Buffer.from(JSON.stringify(request), 'utf-8')

    if (payload.length > MAX_MESSAGE_SIZE) {
      throw new Error(
        `Tool request too large: ${payload.length} bytes (max ${MAX_MESSAGE_SIZE})`,
      )
    }

    const lengthBuf = Buffer.alloc(4)
    lengthBuf.writeUInt32LE(payload.length, 0)
    const frame = Buffer.concat([lengthBuf, payload])

    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingQueue.findIndex(p => p.resolve === resolve)
        if (idx !== -1) this.pendingQueue.splice(idx, 1)
        reject(new Error(`Tool call timeout: ${method}`))
      }, TOOL_CALL_TIMEOUT_MS)

      this.pendingQueue.push({ resolve, reject, timer })

      // Single atomic write; use callback to surface write errors
      socket.write(frame, (err) => {
        if (err) {
          const idx = this.pendingQueue.findIndex(p => p.resolve === resolve)
          if (idx !== -1) {
            this.pendingQueue.splice(idx, 1)
            clearTimeout(timer)
            reject(err)
          }
        }
      })
    })
  }

  disconnect(): void {
    this.handleDisconnect()
  }

  // ── Private ────────────────────────────────────────────────────────

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)

      if (length === 0 || length > MAX_MESSAGE_SIZE) {
        this.context.logger.error(
          `[OpenClaude Chrome] Invalid message length: ${length}`,
        )
        this.handleDisconnect()
        return
      }

      if (this.buffer.length < 4 + length) {
        break
      }

      const messageBytes = this.buffer.subarray(4, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)

      try {
        const message = JSON.parse(messageBytes.toString('utf-8')) as Record<
          string,
          unknown
        >
        this.handleMessage(message)
      } catch (e) {
        this.context.logger.error(
          `[OpenClaude Chrome] Failed to parse message: ${e}`,
        )
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Notifications carry a notificationType field (protocol-reliable discriminant)
    // or deviceId+deviceName (fallback for device_paired events). Always route
    // these to handleNotification regardless of pending queue state — a pairing
    // notification can arrive during a tool call and must not be consumed as a
    // tool response.
    if (
      message.notificationType !== undefined ||
      (message.deviceId !== undefined && message.deviceName !== undefined)
    ) {
      this.handleNotification(message)
      return
    }

    const pending = this.pendingQueue.shift()
    if (pending) {
      clearTimeout(pending.timer)
      pending.resolve(message as ToolResponse)
    } else {
      this.context.logger.debug(
        '[OpenClaude Chrome] Received message with no pending request',
      )
    }
  }

  private handleNotification(message: Record<string, unknown>): void {
    const type = message.notificationType as string | undefined

    if (type === 'device_paired' || (message.deviceId && message.deviceName)) {
      const deviceId = message.deviceId as string
      const deviceName = message.deviceName as string
      this.context.onExtensionPaired(deviceId, deviceName)
    }

    this.context.logger.debug(
      `[OpenClaude Chrome] Notification: ${type ?? 'unknown'}`,
    )
  }

  /**
   * Idempotent teardown — safe to call from error, close, or explicit disconnect.
   * Guards against double-fire (error + close events on the same socket).
   */
  private handleDisconnect(): void {
    if (!this.connected && this.socket === null) return

    this.connected = false
    const s = this.socket
    this.socket = null
    s?.destroy()
    this.rejectAllPending('Native host disconnected')
  }

  private rejectAllPending(reason: string): void {
    for (const pending of this.pendingQueue) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingQueue = []
  }
}
