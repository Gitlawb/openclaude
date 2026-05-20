#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs')
const { basename, resolve } = require('node:path')

function hydrateEnvFromDotEnv() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return

  const envText = readFileSync(envPath, 'utf8')
  for (const rawLine of envText.split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] && process.env[key] !== `\${${key}}`) continue
    process.env[key] = rawValue.trim().replace(/^"(.*)"$/, '$1')
  }
}

function openRAGConfig() {
  const baseUrl = (process.env.OPENRAG_URL || 'http://localhost:3000').replace(/\/+$/, '')
  const apiKey = process.env.OPENRAG_API_KEY
  const timeoutMs = Number(process.env.OPENRAG_MCP_TIMEOUT || 60) * 1000
  if (!apiKey) {
    throw new Error('OPENRAG_API_KEY is required')
  }
  return { baseUrl, apiKey, timeoutMs }
}

function openRAGBaseUrlCandidates(baseUrl) {
  const candidates = [baseUrl]
  try {
    const parsed = new URL(baseUrl)
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'host.docker.internal'
      candidates.push(parsed.toString().replace(/\/+$/, ''))
    }
  } catch {
    // Keep the original URL validation/error behavior in fetch.
  }
  return [...new Set(candidates)]
}

async function openRAGRequest(path, options = {}) {
  const { baseUrl, apiKey, timeoutMs } = openRAGConfig()
  const headers = {
    'X-API-Key': apiKey,
    ...(options.headers || {}),
  }
  let lastError
  for (const candidate of openRAGBaseUrlCandidates(baseUrl)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${candidate}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      })
      const text = await response.text()
      let data = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
      }
      if (!response.ok) {
        const message = data?.error || data?.detail || text || response.statusText
        throw new Error(`OpenRAG ${response.status}: ${message}`)
      }
      return data ?? text
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

function jsonBody(value) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  }
}

function formatSearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 'No OpenRAG results found.'
  }
  return [
    `Found ${results.length} OpenRAG result(s):`,
    ...results.map((item, index) => {
      const title = item.filename || `result-${index + 1}`
      const page = item.page ? ` page ${item.page}` : ''
      const score = typeof item.score === 'number' ? `, relevance ${item.score.toFixed(2)}` : ''
      const text = String(item.text || '').trim()
      return `\n---\n${index + 1}. ${title}${page}${score}\n${text}`
    }),
  ].join('\n')
}

function compactError(error) {
  const text = String(error?.message || error || 'unknown error').replace(/\s+/g, ' ').trim()
  if (!text) return 'unknown error'
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

async function search(arguments_) {
  const query = String(arguments_?.query || '').trim()
  if (!query) throw new Error('query is required')
  const limit = Number(arguments_?.limit || 10)
  const scoreThreshold = Number(arguments_?.score_threshold || arguments_?.scoreThreshold || 0)
  const data = await openRAGRequest('/api/v1/search', jsonBody({
    query,
    limit,
    score_threshold: scoreThreshold,
    filters: arguments_?.filters || undefined,
  }))
  return formatSearchResults(data.results || [])
}

async function chat(arguments_) {
  const message = String(arguments_?.message || arguments_?.query || '').trim()
  if (!message) throw new Error('message is required')
  try {
    const data = await openRAGRequest('/api/v1/chat', jsonBody({ message }))
    const response = data.response || data.message || JSON.stringify(data, null, 2)
    const sources = data.sources?.length ? `\n\nSources:\n${formatSearchResults(data.sources)}` : ''
    return `${response}${sources}`
  } catch (error) {
    const fallback = await search({ query: message, limit: arguments_?.limit || 5 })
    return [
      'OpenRAG chat endpoint failed; using retrieval fallback.',
      compactError(error),
      '',
      fallback,
    ].join('\n')
  }
}

async function ingestFile(arguments_) {
  const filePath = String(arguments_?.file_path || arguments_?.path || '').trim()
  if (!filePath) throw new Error('file_path is required')
  const resolvedPath = resolve(filePath)
  if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`)

  const form = new FormData()
  const bytes = readFileSync(resolvedPath)
  form.append('file', new Blob([bytes]), basename(resolvedPath))
  form.append('replace_duplicates', String(arguments_?.replace_duplicates ?? true))
  form.append('delete_after_ingest', String(arguments_?.delete_after_ingest ?? true))
  if (arguments_?.create_filter !== undefined) {
    form.append('create_filter', String(arguments_.create_filter))
  }

  const data = await openRAGRequest('/api/v1/documents/ingest', {
    method: 'POST',
    body: form,
  })
  if (data.task_id) {
    return `Queued ${basename(resolvedPath)} for OpenRAG ingestion.\nTask ID: ${data.task_id}\nStatus: ${data.status || 'queued'}`
  }
  return `Indexed ${basename(resolvedPath)} in OpenRAG.\n${JSON.stringify(data, null, 2)}`
}

async function getSettings() {
  const data = await openRAGRequest('/api/v1/settings')
  return JSON.stringify(data, null, 2)
}

async function updateSettings(arguments_) {
  const data = await openRAGRequest('/api/v1/settings', jsonBody(arguments_ || {}))
  return JSON.stringify(data, null, 2)
}

async function listModels(arguments_) {
  const provider = String(arguments_?.provider || 'ollama').trim()
  const data = await openRAGRequest(`/api/v1/models/${encodeURIComponent(provider)}`)
  return JSON.stringify(data, null, 2)
}

const tools = [
  {
    name: 'openrag_search',
    description: 'Search OpenRAG knowledge base and return grounded document chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 10 },
        score_threshold: { type: 'number', default: 0 },
        filters: { type: 'object' },
      },
      required: ['query'],
    },
  },
  {
    name: 'openrag_chat',
    description: 'Ask OpenRAG. Falls back to retrieval results if the upstream chat flow is unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        limit: { type: 'number', default: 5 },
      },
      required: ['message'],
    },
  },
  {
    name: 'openrag_ingest_file',
    description: 'Ingest a local file into OpenRAG through the stable HTTP API.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        replace_duplicates: { type: 'boolean', default: true },
        delete_after_ingest: { type: 'boolean', default: true },
        create_filter: { type: 'boolean' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'openrag_get_settings',
    description: 'Read current OpenRAG settings.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'openrag_update_settings',
    description: 'Update OpenRAG settings using the public settings API.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'openrag_list_models',
    description: 'List models known by OpenRAG for a provider.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', default: 'ollama' },
      },
    },
  },
]

async function main() {
  hydrateEnvFromDotEnv()

  const [
    { Server },
    { StdioServerTransport },
    types,
  ] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/index.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ])

  const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
  } = types

  const server = new Server(
    { name: 'openclaude-openrag', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const name = request.params.name
      const args = request.params.arguments || {}
      let text
      if (name === 'openrag_search') text = await search(args)
      else if (name === 'openrag_chat') text = await chat(args)
      else if (name === 'openrag_ingest_file') text = await ingestFile(args)
      else if (name === 'openrag_get_settings') text = await getSettings()
      else if (name === 'openrag_update_settings') text = await updateSettings(args)
      else if (name === 'openrag_list_models') text = await listModels(args)
      else throw new Error(`Unknown tool: ${name}`)

      return { content: [{ type: 'text', text }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: String(error?.stack || error?.message || error) }],
      }
    }
  })

  await server.connect(new StdioServerTransport())
}

main().catch(error => {
  console.error(`[openrag-mcp-bridge] ${error?.stack || error?.message || error}`)
  process.exit(1)
})
