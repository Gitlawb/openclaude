import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { createFetchWithInit } from '@modelcontextprotocol/sdk/shared/transport.js'
import { getMCPUserAgent } from '../../../../utils/http.js'
import { getProxyFetchOptions } from '../../../../utils/proxy.js'
import { ClaudeAuthProvider, wrapFetchWithStepUpDetection } from '../../auth.js'
import { wrapFetchWithTimeout } from '../../client.js'
import { getMcpServerHeaders } from '../../headersHelper.js'
import type {
  TransportFactory,
  TransportFactoryOptions,
  TransportResult,
} from '../types.js'

/**
 * Factory for creating SSE (Server-Sent Events) transports.
 * Supports both authenticated SSE (for remote MCP servers) and SSE-IDE (for IDE integration).
 */
export class SSETransportFactory implements TransportFactory {
  async createTransport(
    name: string,
    serverRef: {
      type?: string
      url?: string
    },
    options: TransportFactoryOptions,
  ): Promise<TransportResult> {
    const serverUrl = serverRef.url
    if (!serverUrl) {
      throw new Error('SSE transport requires a URL')
    }

    const isIdeTransport = serverRef.type === 'sse-ide'

    options.logDebug(
      isIdeTransport
        ? `Setting up SSE-IDE transport to ${serverUrl}`
        : `SSE transport initialized, awaiting connection`,
    )

    const transportOptions: SSEClientTransportOptions = {}

    if (isIdeTransport) {
      // IDE servers don't need authentication
      // TODO: Use the auth token provided in the lockfile
      const proxyOptions = getProxyFetchOptions()
      if (proxyOptions.dispatcher) {
        transportOptions.eventSourceInit = {
          fetch: async (url: string | URL, init?: RequestInit) => {
            // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
            return fetch(url, {
              ...init,
              ...proxyOptions,
              headers: {
                'User-Agent': getMCPUserAgent(),
                ...init?.headers,
              },
            })
          },
        }
      }
    } else {
      // Create an auth provider for this server
      const authProvider = new ClaudeAuthProvider(
        name,
        serverRef as { type: 'sse'; url: string },
      )

      // Get combined headers (static + dynamic)
      const combinedHeaders = await getMcpServerHeaders(
        name,
        serverRef as { type: 'sse'; url: string },
      )

      // Use the auth provider with SSEClientTransport
      transportOptions.authProvider = authProvider
      // Use fresh timeout per request to avoid stale AbortSignal bug.
      // Step-up detection wraps innermost so the 403 is seen before the
      // SDK's handler calls auth() → tokens().
      transportOptions.fetch = wrapFetchWithTimeout(
        wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
      )
      transportOptions.requestInit = {
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...combinedHeaders,
        },
      }

      // IMPORTANT: Always set eventSourceInit with a fetch that does NOT use the
      // timeout wrapper. The EventSource connection is long-lived (stays open indefinitely
      // to receive server-sent events), so applying a 60-second timeout would kill it.
      // The timeout is only meant for individual API requests (POST, auth refresh), not
      // the persistent SSE stream.
      transportOptions.eventSourceInit = {
        fetch: async (url: string | URL, init?: RequestInit) => {
          // Get auth headers from the auth provider
          const authHeaders: Record<string, string> = {}
          const tokens = await authProvider.tokens()
          if (tokens) {
            authHeaders.Authorization = `Bearer ${tokens.access_token}`
          }

          const proxyOptions = getProxyFetchOptions()
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          return fetch(url, {
            ...init,
            ...proxyOptions,
            headers: {
              'User-Agent': getMCPUserAgent(),
              ...authHeaders,
              ...init?.headers,
              ...combinedHeaders,
              Accept: 'text/event-stream',
            },
          })
        },
      }
    }

    const transport = new SSEClientTransport(
      new URL(serverUrl),
      Object.keys(transportOptions).length > 0 ? transportOptions : undefined,
    )

    return { transport }
  }
}
