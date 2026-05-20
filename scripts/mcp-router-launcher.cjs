#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

function hydrateEnvFromDotEnv() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return

  const envText = readFileSync(envPath, 'utf8')
  const preferDotEnv = new Set(['MCPR_TOKEN', 'MCPR_HOST', 'MCPR_PORT', 'MCPR_PROJECT'])
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (
      process.env[key] &&
      process.env[key] !== `\${${key}}` &&
      !preferDotEnv.has(key)
    ) {
      continue
    }
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
  }
}

async function main() {
  hydrateEnvFromDotEnv()

  const [
    { Client },
    { StreamableHTTPClientTransport },
    { Server },
    { StdioServerTransport },
    types,
  ] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/server/index.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ])

  const {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
  } = types

  const host = process.env.MCPR_HOST || '127.0.0.1'
  const port = process.env.MCPR_PORT || '3282'
  const token = process.env.MCPR_TOKEN
  const project = process.env.MCPR_PROJECT
  const headers = {}
  if (token && token !== '${MCPR_TOKEN}') headers.authorization = `Bearer ${token}`
  if (project) headers['x-mcpr-project'] = project

  const httpClient = new Client({
    name: 'openclaude-agent-mcp-router',
    version: '0.0.1',
  })
  const httpTransport = new StreamableHTTPClientTransport(
    new URL(`http://${host}:${port}/mcp`),
    { requestInit: { headers } },
  )
  await httpClient.connect(httpTransport)

  const server = new Server(
    { name: 'mcp-router', version: '0.0.1' },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return await httpClient.listTools()
  })

  server.setRequestHandler(CallToolRequestSchema, async request => {
    return await httpClient.callTool(
      {
        name: request.params.name,
        arguments: request.params.arguments || {},
      },
      undefined,
      {
        timeout: 60 * 60 * 1000,
        resetTimeoutOnProgress: true,
      },
    )
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return await httpClient.listResources()
  })

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    if (typeof httpClient.listResourceTemplates === 'function') {
      return await httpClient.listResourceTemplates()
    }
    return { resourceTemplates: [] }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    return await httpClient.readResource({ uri: request.params.uri })
  })

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return await httpClient.listPrompts()
  })

  server.setRequestHandler(GetPromptRequestSchema, async request => {
    return await httpClient.getPrompt({
      name: request.params.name,
      arguments: request.params.arguments || {},
    })
  })

  let closing = false
  const close = async (code = 0) => {
    if (closing) return
    closing = true
    await Promise.allSettled([server.close(), httpClient.close()])
    process.exit(code)
  }

  process.once('SIGINT', () => void close(0))
  process.once('SIGTERM', () => void close(0))
  process.stdin.once('end', () => void close(0))
  process.stdin.once('close', () => void close(0))

  await server.connect(new StdioServerTransport())
}

main().catch(error => {
  console.error(`[mcp-router] ${error?.stack || error?.message || error}`)
  process.exit(1)
})
