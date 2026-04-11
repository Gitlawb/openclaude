import mapValues from 'lodash-es/mapValues.js'
import { getMCPUserAgent } from '../../../../utils/http.js'
import { WebSocketTransport } from '../../../../utils/mcpWebSocketTransport.js'
import { getWebSocketTLSOptions } from '../../../../utils/mtls.js'
import {
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../../../utils/proxy.js'
import { getMcpServerHeaders } from '../../headersHelper.js'
import { createNodeWsClient } from '../WebSocketFactory.js'
import type {
  TransportFactory,
  TransportFactoryOptions,
  TransportResult,
  WsClientLike,
} from '../types.js'

/**
 * Factory for creating WebSocket transports.
 * Supports both authenticated WS (for remote MCP servers) and WS-IDE (for IDE integration).
 */
export class WebSocketTransportFactory implements TransportFactory {
  async createTransport(
    name: string,
    serverRef: {
      type?: string
      url?: string
      authToken?: string
    },
    options: TransportFactoryOptions,
  ): Promise<TransportResult> {
    const serverUrl = serverRef.url
    if (!serverUrl) {
      throw new Error('WebSocket transport requires a URL')
    }

    const isIdeTransport = serverRef.type === 'ws-ide'
    const sessionIngressToken = options.sessionIngressToken

    options.logDebug(`Initializing WebSocket transport to ${serverUrl}`)

    const tlsOptions = getWebSocketTLSOptions()

    let wsHeaders: Record<string, string>

    if (isIdeTransport) {
      wsHeaders = {
        'User-Agent': getMCPUserAgent(),
        ...(serverRef.authToken && {
          'X-Claude-Code-Ide-Authorization': serverRef.authToken,
        }),
      }
    } else {
      const combinedHeaders = await getMcpServerHeaders(name, serverRef)
      wsHeaders = {
        'User-Agent': getMCPUserAgent(),
        ...(sessionIngressToken && {
          Authorization: `Bearer ${sessionIngressToken}`,
        }),
        ...combinedHeaders,
      }

      // Redact sensitive headers before logging
      const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
        key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
      )

      options.logDebug(`WebSocket transport options prepared`, {
        url: serverUrl,
        headers: wsHeadersForLogging,
        hasSessionAuth: !!sessionIngressToken,
      })
    }

    let wsClient: WsClientLike
    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy/tls options but the DOM typings don't
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      wsClient = new globalThis.WebSocket(serverUrl, {
        protocols: ['mcp'],
        headers: wsHeaders,
        proxy: getWebSocketProxyUrl(serverUrl),
        tls: tlsOptions || undefined,
      } as unknown as string[])
    } else {
      wsClient = await createNodeWsClient(serverUrl, {
        headers: wsHeaders,
        agent: getWebSocketProxyAgent(serverUrl),
        ...(tlsOptions || {}),
      })
    }
    const transport = new WebSocketTransport(wsClient)

    return { transport }
  }
}
