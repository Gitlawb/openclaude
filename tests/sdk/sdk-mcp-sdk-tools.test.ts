import { describe, test, expect } from 'bun:test'
import { tool, createSdkMcpServer, query } from '../../src/entrypoints/sdk/index.js'

// Type-level test: SdkMcpSdkConfig accepts tools field
type AssertToolsField = {
  type: 'sdk'
  name: string
  tools?: any[]
}

describe('SDK MCP type:sdk tools wiring', () => {
  test('createSdkMcpServer with type:sdk and tools compiles and works', () => {
    // This is primarily a type-level test — ensuring the API accepts tools
    const myTool = tool(
      'echo',
      'Echo back the input',
      { type: 'object', properties: { message: { type: 'string' } } },
      async (args: { message: string }) => ({
        content: [{ type: 'text', text: args.message }],
      }),
    )

    const sdkServer = createSdkMcpServer({
      type: 'sdk',
      name: 'my-sdk-tools',
      tools: [myTool],
    })

    // Verify scope is set
    expect(sdkServer.scope).toBe('session')
    expect(sdkServer.type).toBe('sdk')
    expect(sdkServer.name).toBe('my-sdk-tools')
    expect(sdkServer.tools).toBeDefined()
    expect(sdkServer.tools!.length).toBe(1)
    expect(sdkServer.tools![0].name).toBe('echo')
  })

  test('tool() helper produces SdkMcpToolDefinition with handler', () => {
    const myTool = tool(
      'add',
      'Add two numbers',
      { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      async (args: { a: number; b: number }) => ({
        content: [{ type: 'text', text: String(args.a + args.b) }],
      }),
    )

    expect(myTool.name).toBe('add')
    expect(myTool.description).toBe('Add two numbers')
    expect(myTool.handler).toBeDefined()
    expect(typeof myTool.handler).toBe('function')
  })

  test('query with mcpServers containing type:sdk tools validates', async () => {
    // This test ensures the query() function accepts mcpServers with SDK-type configs
    const myTool = tool(
      'greet',
      'Greet someone',
      { type: 'object', properties: { name: { type: 'string' } } },
      async (args: { name: string }) => ({
        content: [{ type: 'text', text: `Hello, ${args.name}!` }],
      }),
    )

    const q = query({
      prompt: 'test',
      options: {
        cwd: process.cwd(),
        mcpServers: {
          'sdk-tools': createSdkMcpServer({
            type: 'sdk',
            name: 'sdk-tools',
            tools: [myTool],
          }),
        },
      },
    })

    // Query was created successfully — that's the validation
    expect(q.sessionId).toBeDefined()
    q.close()
  })
})