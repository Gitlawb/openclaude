/**
 * MCP Client - Model Context Protocol client
 * 
 * MCP protocol for connecting AI assistants to external tools.
 */

import { randomUUID } from 'crypto'

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPResource {
  uri: string
  name: string
  mimeType?: string
}

export interface MCPServerConfig {
  name: string
  url: string
  auth?: { type: 'bearer' | 'apikey'; credential: string }
  timeout?: number
}

export interface MCPServer {
  id: string
  name: string
  url: string
  tools: MCPTool[]
  resources: MCPResource[]
  connected: boolean
  lastSeen?: number
}

export interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

class MCPClientCore {
  private url: string
  private auth?: MCPServerConfig['auth']
  private timeout: number
  private requestId = 0

  constructor(config: MCPServerConfig) {
    this.url = config.url
    this.auth = config.auth
    this.timeout = config.timeout ?? 30000
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.auth?.type === 'bearer') headers['Authorization'] = `Bearer ${this.auth.credential}`
    if (this.auth?.type === 'apikey') headers['X-API-Key'] = this.auth.credential

    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) throw new Error(`MCP error: ${response.status}`)
    const data = (await response.json()) as MCPResponse
    if (data.error) throw new Error(`MCP: ${data.error.message}`)
    return data.result as T
  }
}

export async function connectMCPServer(config: MCPServerConfig): Promise<MCPServer> {
  const client = new MCPClientCore(config)
  await client.send('initialize', { protocolVersion: '2024-11-05' })
  const tools = await client.send<{ tools: MCPTool[] }>('tools/list')
  const resources = await client.send<{ resources: MCPResource[] }>('resources/list')

  return {
    id: randomUUID(),
    name: config.name,
    url: config.url,
    tools: tools.tools ?? [],
    resources: resources.resources ?? [],
    connected: true,
    lastSeen: Date.now(),
  }
}

export async function callMCPTool(server: MCPServer, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const client = new MCPClientCore({ name: server.name, url: server.url })
  return client.send('tools/call', { name: toolName, arguments: args })
}

export async function pingMCPServer(server: MCPServer): Promise<boolean> {
  try {
    const client = new MCPClientCore({ name: server.name, url: server.url })
    await client.send('ping', {})
    return true
  } catch {
    return false
  }
}