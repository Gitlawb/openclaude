import { describe, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { unstable_v2_createSession } from '../../src/entrypoints/sdk/index.js'
import { query } from '../../src/entrypoints/sdk/index.js'
import type { MCPServerConnection } from '../../src/services/mcp/types.js'

// sendMessage drains trigger init(), which checks auth. Stub it for CI.
const AUTH_KEY = 'ANTHROPIC_API_KEY'
let savedApiKey: string | undefined

beforeAll(() => {
  savedApiKey = process.env[AUTH_KEY]
  if (!savedApiKey) process.env[AUTH_KEY] = 'sk-test-mcp-cleanup-stub'
})

afterAll(() => {
  if (savedApiKey === undefined) delete process.env[AUTH_KEY]
  else process.env[AUTH_KEY] = savedApiKey
})

describe('MCP cleanup on session close', () => {
  test('session.close() disconnects MCP clients', async () => {
    // Create a mock MCP client with a close method
    const mockClose = vi.fn()
    const mockMcpClient: MCPServerConnection = {
      type: 'connected',
      name: 'test-server',
      connection: {
        close: mockClose,
      },
      serverInfo: { name: 'test', version: '1.0' },
      tools: [],
      config: { scope: 'session' },
    }

    // Create session with mock MCP client injected via engine override
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })

    // Inject mock MCP client into the engine's config
    // This simulates what would happen after connectSdkMcpServers()
    const sessionImpl = session as any
    if (sessionImpl._engine?.config) {
      sessionImpl._engine.config.mcpClients = [mockMcpClient]
    }

    // Close the session
    session.close()

    // Verify MCP client was disconnected
    expect(mockClose).toHaveBeenCalled()
  })

  test('session.close() handles MCP cleanup errors gracefully', async () => {
    // Create a mock MCP client that throws on close
    const mockClose = vi.fn(() => {
      throw new Error('MCP cleanup error')
    })
    const mockMcpClient: MCPServerConnection = {
      type: 'connected',
      name: 'error-server',
      connection: {
        close: mockClose,
      },
      serverInfo: { name: 'test', version: '1.0' },
      tools: [],
      config: { scope: 'session' },
    }

    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })

    // Inject mock MCP client
    const sessionImpl = session as any
    if (sessionImpl._engine?.config) {
      sessionImpl._engine.config.mcpClients = [mockMcpClient]
    }

    // Close should not throw despite MCP cleanup error
    expect(() => session.close()).not.toThrow()

    // Verify close was attempted even though it threw
    expect(mockClose).toHaveBeenCalled()
  })

  test('session.close() clears engine reference', async () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })

    const sessionImpl = session as any
    expect(sessionImpl._engine).not.toBeNull()

    session.close()

    // Engine reference should be cleared
    expect(sessionImpl._engine).toBeNull()
  })

  test('session.close() handles missing MCP clients gracefully', async () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })

    // Remove MCP clients to simulate no MCP servers connected
    const sessionImpl = session as any
    if (sessionImpl._engine?.config) {
      sessionImpl._engine.config.mcpClients = undefined
    }

    // Close should not throw
    expect(() => session.close()).not.toThrow()
  })

  test('session.close() handles failed MCP clients (no connection)', async () => {
    // Failed client has no connection property
    const mockMcpClient: MCPServerConnection = {
      type: 'failed',
      name: 'failed-server',
      error: 'Connection refused',
      config: { scope: 'session' },
    }

    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })

    const sessionImpl = session as any
    if (sessionImpl._engine?.config) {
      sessionImpl._engine.config.mcpClients = [mockMcpClient]
    }

    // Close should not throw - failed clients have no close method
    expect(() => session.close()).not.toThrow()
  })
})

describe('MCP cleanup on query close', () => {
  test('query.close() disconnects MCP clients', async () => {
    const mockClose = vi.fn()
    const mockMcpClient: MCPServerConnection = {
      type: 'connected',
      name: 'test-server',
      connection: {
        close: mockClose,
      },
      serverInfo: { name: 'test', version: '1.0' },
      tools: [],
      config: { scope: 'session' },
    }

    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })

    // Inject mock MCP client
    const queryImpl = q as any
    if (queryImpl._engine?.config) {
      queryImpl._engine.config.mcpClients = [mockMcpClient]
    }

    q.close()

    expect(mockClose).toHaveBeenCalled()
  })

  test('query.close() handles MCP cleanup errors gracefully', async () => {
    const mockClose = vi.fn(() => {
      throw new Error('MCP cleanup error')
    })
    const mockMcpClient: MCPServerConnection = {
      type: 'connected',
      name: 'error-server',
      connection: {
        close: mockClose,
      },
      serverInfo: { name: 'test', version: '1.0' },
      tools: [],
      config: { scope: 'session' },
    }

    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })

    const queryImpl = q as any
    if (queryImpl._engine?.config) {
      queryImpl._engine.config.mcpClients = [mockMcpClient]
    }

    expect(() => q.close()).not.toThrow()
    expect(mockClose).toHaveBeenCalled()
  })

  test('query.close() clears engine reference', async () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })

    const queryImpl = q as any
    expect(queryImpl._engine).not.toBeNull()

    q.close()

    expect(queryImpl._engine).toBeNull()
  })

  test('query.close() handles missing MCP clients gracefully', async () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })

    const queryImpl = q as any
    if (queryImpl._engine?.config) {
      queryImpl._engine.config.mcpClients = undefined
    }

    expect(() => q.close()).not.toThrow()
  })
})