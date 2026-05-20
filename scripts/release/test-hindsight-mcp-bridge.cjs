#!/usr/bin/env node

const http = require('node:http')
const { resolve } = require('node:path')

function readJson(request) {
  return new Promise((resolve_, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve_(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
  })
}

function writeJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function startMockHindsight() {
  const memories = []
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { status: 'ok' })
        return
      }
      if (request.method === 'POST' && url.pathname.endsWith('/memories')) {
        const body = await readJson(request)
        memories.push(...(body.items || []))
        writeJson(response, 200, {
          success: true,
          bank_id: 'openclaude-agent',
          items_count: body.items?.length || 0,
          async: Boolean(body.async),
        })
        return
      }
      if (request.method === 'POST' && url.pathname.endsWith('/memories/recall')) {
        const body = await readJson(request)
        writeJson(response, 200, {
          results: memories.map((item, index) => ({
            id: `memory-${index + 1}`,
            text: item.content,
            type: 'experience',
            context: item.context,
          })),
          trace: { query: body.query, num_results: memories.length },
        })
        return
      }
      if (request.method === 'POST' && url.pathname.endsWith('/reflect')) {
        const body = await readJson(request)
        writeJson(response, 200, {
          text: `Reflect answer for: ${body.query}`,
          based_on: { memories: memories.map(item => ({ text: item.content, type: 'experience' })) },
        })
        return
      }
      if (request.method === 'POST' && url.pathname.endsWith('/consolidate')) {
        writeJson(response, 200, { operation_id: 'mock-consolidate', deduplicated: true })
        return
      }
      writeJson(response, 404, { error: `Unhandled ${request.method} ${url.pathname}` })
    } catch (error) {
      writeJson(response, 500, { error: String(error?.stack || error?.message || error) })
    }
  })

  return new Promise((resolve_, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve_({
        server,
        url: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

function textContent(result) {
  return (result.content || []).map(item => item.text || '').join('\n')
}

async function main() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const mock = await startMockHindsight()
  const bridgePath = resolve('scripts/release/hindsight-mcp-bridge.cjs')
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bridgePath],
    env: {
      ...process.env,
      HINDSIGHT_URL: mock.url,
      HINDSIGHT_BANK_ID: 'openclaude-agent',
      HINDSIGHT_MCP_TIMEOUT: '10',
    },
  })
  const client = new Client({ name: 'hindsight-bridge-smoke', version: '0.1.0' })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    const toolNames = tools.tools.map(tool => tool.name)
    for (const expected of ['hindsight_health', 'hindsight_retain', 'hindsight_recall', 'hindsight_reflect', 'hindsight_consolidate']) {
      if (!toolNames.includes(expected)) throw new Error(`Missing tool: ${expected}`)
    }

    const health = textContent(await client.callTool({ name: 'hindsight_health', arguments: {} }))
    if (!health.includes('ok')) throw new Error(`Unexpected health result: ${health}`)

    const retain = textContent(await client.callTool({
      name: 'hindsight_retain',
      arguments: {
        content: 'OpenClaude remembers Camofox for browser automation and OpenRAG for document retrieval.',
        context: 'agent capabilities',
        tags: ['openclaude', 'capability'],
      },
    }))
    if (!retain.includes('Retained Hindsight memory')) throw new Error(`Unexpected retain result: ${retain}`)

    const recall = textContent(await client.callTool({
      name: 'hindsight_recall',
      arguments: { query: 'What should OpenClaude remember about Camofox?' },
    }))
    if (!recall.includes('Camofox')) throw new Error(`Unexpected recall result: ${recall}`)

    const reflect = textContent(await client.callTool({
      name: 'hindsight_reflect',
      arguments: { query: 'Summarize OpenClaude memory capabilities.' },
    }))
    if (!reflect.includes('Reflect answer')) throw new Error(`Unexpected reflect result: ${reflect}`)

    const consolidate = textContent(await client.callTool({ name: 'hindsight_consolidate', arguments: {} }))
    if (!consolidate.includes('mock-consolidate')) throw new Error(`Unexpected consolidate result: ${consolidate}`)

    console.log('HINDSIGHT_MCP_BRIDGE_SMOKE_OK')
  } finally {
    await client.close().catch(() => {})
    await new Promise(resolve_ => mock.server.close(resolve_))
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
