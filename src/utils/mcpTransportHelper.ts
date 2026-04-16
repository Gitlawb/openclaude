/**
 * MCP Transport Helper Utilities
 * 
 * Provides HTTP transport detection and health checking for MCP servers.
 * Complements the existing @modelcontextprotocol/sdk implementation.
 */

import { logMCPDebug } from './log.js'

export type MCPTransportType = 'stdio' | 'sse' | 'http' | 'ws' | 'sdk' | 'unknown'

export interface MCPEndpointInfo {
  url?: string
  command?: string
  transportType: MCPTransportType
}

export function detectMCPTransport(
  url?: string,
  command?: string,
  type?: string,
): MCPTransportType {
  // Explicit type from config
  if (type === 'stdio') return 'stdio'
  if (type === 'sse') return 'sse'
  if (type === 'http') return 'http'
  if (type === 'ws') return 'ws'
  if (type === 'sdk') return 'sdk'

  // URL-based detection
  if (url) {
    if (url.startsWith('ws://') || url.startsWith('wss://')) return 'ws'
    if (url.startsWith('http://') || url.startsWith('https://')) return 'http'
  }

  // Command-based (stdio)
  if (command) return 'stdio'

  return 'unknown'
}

export function isHTTPBasedMCPTransport(transport: MCPTransportType): boolean {
  return transport === 'http' || transport === 'sse' || transport === 'ws'
}

export function getMCPEndpointInfo(
  config: { url?: string; command?: string; type?: string },
): MCPEndpointInfo {
  return {
    url: config.url,
    command: config.command,
    transportType: detectMCPTransport(config.url, config.command, config.type),
  }
}

export async function checkMCPHealth(
  serverName: string,
  url: string,
  timeoutMs: number = 5000,
): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  const startTime = Date.now()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime
    
    if (response.ok) {
      logMCPDebug(serverName, `Health check passed (${latencyMs}ms)`)
      return { healthy: true, latencyMs }
    }
    
    const errorText = await response.text().catch(() => 'Unknown error')
    logMCPDebug(serverName, `Health check failed: ${response.status} ${errorText}`)
    return { healthy: false, latencyMs, error: `HTTP ${response.status}` }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    logMCPDebug(serverName, `Health check error: ${errorMessage}`)
    return { healthy: false, latencyMs, error: errorMessage }
  }
}