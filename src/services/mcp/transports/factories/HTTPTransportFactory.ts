import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import mapValues from 'lodash-es/mapValues.js'
import { getSessionId } from '../../../../bootstrap/state.js'
import { getOauthConfig } from '../../../../constants/oauth.js'
import { getMCPUserAgent } from '../../../../utils/http.js'
import { getProxyFetchOptions } from '../../../../utils/proxy.js'
import { ClaudeAuthProvider } from '../../auth.js'
import {
  createClaudeAiProxyFetch,
  wrapFetchWithTimeout,
} from '../../client.js'
import { wrapFetchWithStepUpDetection } from '../../auth.js'
import { createFetchWithInit } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  TransportFactory,
  TransportFactoryOptions,
  TransportResult,
} from '../types.js'
import { getMcpServerHeaders } from '../../headersHelper.js'

const MCP_REQUEST_TIMEOUT_MS = 60000

/**
 * Factory for creating HTTP (StreamableHTTP) transports.
 */
export class HTTPTransportFactory implements TransportFactory {
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
      throw new Error('HTTP transport requires a URL')
    }

    options.logDebug(`Initializing HTTP transport to ${serverUrl}`)
    options.logDebug(`Node version: ${process.version}, Platform: ${process.platform}`)
    options.logDebug(`Environment: ${JSON.stringify({
      NODE_OPTIONS: process.env.NODE_OPTIONS || 'not set',
      UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || 'default',
      HTTP_PROXY: process.env.HTTP_PROXY || 'not set',
      HTTPS_PROXY: process.env.HTTPS_PROXY || 'not set',
      NO_PROXY: process.env.NO_PROXY || 'not set',
    })}`)

    // Create an auth provider for this server
    const authProvider = new ClaudeAuthProvider(name, serverRef)

    // Get combined headers (static + dynamic)
    const combinedHeaders = await getMcpServerHeaders(name, serverRef)

    // Check if this server has stored OAuth tokens
    const hasOAuthTokens = !!(await authProvider.tokens())
    const sessionIngressToken = options.sessionIngressToken

    // Use the auth provider with StreamableHTTPClientTransport
    const proxyOptions = getProxyFetchOptions()
    options.logDebug(`Proxy options: ${proxyOptions.dispatcher ? 'custom dispatcher' : 'default'}`)

    const transportOptions: StreamableHTTPClientTransportOptions = {
      authProvider,
      fetch: wrapFetchWithTimeout(
        wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
      ),
      requestInit: {
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...(sessionIngressToken &&
            !hasOAuthTokens && {
            Authorization: `Bearer ${sessionIngressToken}`,
          }),
          ...combinedHeaders,
        },
      },
    }

    // Redact sensitive headers before logging
    const headersForLogging = transportOptions.requestInit?.headers
      ? mapValues(
        transportOptions.requestInit.headers as Record<string, string>,
        (value, key) =>
          key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
      )
      : undefined

    options.logDebug(`HTTP transport options`, {
      url: serverUrl,
      headers: headersForLogging,
      hasAuthProvider: !!authProvider,
      timeoutMs: MCP_REQUEST_TIMEOUT_MS,
    })

    const transport = new StreamableHTTPClientTransport(
      new URL(serverUrl),
      transportOptions,
    )
    options.logDebug(`HTTP transport created successfully`)

    return { transport }
  }
}

/**
 * Factory for creating claude.ai proxy transports.
 */
export class ClaudeAiProxyTransportFactory implements TransportFactory {
  async createTransport(
    name: string,
    serverRef: {
      type?: string
      id?: string
    },
    options: TransportFactoryOptions,
  ): Promise<TransportResult> {
    const serverId = serverRef.id
    if (!serverId) {
      throw new Error('claude.ai proxy transport requires a server ID')
    }

    options.logDebug(`Initializing claude.ai proxy transport for server ${serverId}`)

    const oauthConfig = getOauthConfig()
    const proxyUrl = `${oauthConfig.MCP_PROXY_URL}${oauthConfig.MCP_PROXY_PATH.replace('{server_id}', serverId)}`

    options.logDebug(`Using claude.ai proxy at ${proxyUrl}`)

    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const fetchWithAuth = createClaudeAiProxyFetch(globalThis.fetch)

    const proxyOptions = getProxyFetchOptions()
    const transportOptions: StreamableHTTPClientTransportOptions = {
      fetch: wrapFetchWithTimeout(fetchWithAuth),
      requestInit: {
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          'X-Mcp-Client-Session-Id': getSessionId(),
        },
      },
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(proxyUrl),
      transportOptions,
    )
    options.logDebug(`claude.ai proxy transport created successfully`)

    return { transport }
  }
}
