import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlPermissionRequest } from '../entrypoints/sdk/controlTypes.js'
import type { RemotePermissionResponse } from '../remote/RemoteSessionManager.js'

export type SSHSessionManager = {
  connect(): void
  disconnect(): void
  sendMessage(content: unknown): Promise<boolean>
  cancelRequest(): void
  sendInterrupt(): void
  respondToPermissionRequest(
    requestId: string,
    response: RemotePermissionResponse,
  ): void
}

export type SSHSession = {
  proc: {
    exitCode: number | null
    signalCode?: string | null
  }
  proxy: {
    stop(): void
  }
  getStderrTail(): string
  createManager(callbacks: {
    onMessage: (message: SDKMessage) => void
    onPermissionRequest: (
      request: SDKControlPermissionRequest,
      requestId: string,
    ) => void
    onConnected: () => void
    onReconnecting: (attempt: number, max: number) => void
    onDisconnected: () => void
    onError: (error: Error) => void
  }): SSHSessionManager
}
