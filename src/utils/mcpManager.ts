/**
 * MCP Manager - MCP server registry
 */

import { connectMCPServer, pingMCPServer, callMCPTool, type MCPServer, type MCPServerConfig, type MCPTool, type MCPResource } from './mcpClient.js'

const servers = new Map<string, MCPServer>()
const configs = new Map<string, MCPServerConfig>()

export function getConnectedServers(): MCPServer[] {
  return Array.from(servers.values())
}

export function getAllTools(): MCPTool[] {
  return Array.from(servers.values()).flatMap(s => s.tools)
}

export function getAllResources(): MCPResource[] {
  return Array.from(servers.values()).flatMap(s => s.resources)
}

export async function addMCPServer(config: MCPServerConfig): Promise<MCPServer> {
  const server = await connectMCPServer(config)
  servers.set(server.id, server)
  configs.set(server.id, config)
  return server
}

export async function removeMCPServer(id: string): Promise<boolean> {
  servers.delete(id)
  configs.delete(id)
  return true
}

export async function pingServer(id: string): Promise<boolean> {
  const server = servers.get(id)
  if (!server) return false
  return pingMCPServer(server)
}

export async function callTool(id: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const server = servers.get(id)
  if (!server) throw new Error(`Server not found: ${id}`)
  return callMCPTool(server, toolName, args)
}

export function getServerCount(): number {
  return servers.size
}

export function getToolCount(): number {
  return getAllTools().length
}