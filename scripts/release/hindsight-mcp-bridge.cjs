#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

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

function envValue(name) {
  const value = process.env[name] || ''
  return /^\$\{[A-Z0-9_]+\}$/i.test(value) ? '' : value
}

function config() {
  return {
    baseUrl: (envValue('HINDSIGHT_URL') || 'http://localhost:8888').replace(/\/+$/, ''),
    apiKey: envValue('HINDSIGHT_API_KEY'),
    bankId: envValue('HINDSIGHT_BANK_ID') || 'openclaude-agent',
    timeoutMs: Number(envValue('HINDSIGHT_MCP_TIMEOUT') || 60) * 1000,
  }
}

function baseUrlCandidates(baseUrl) {
  const candidates = [baseUrl]
  try {
    const parsed = new URL(baseUrl)
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'host.docker.internal'
      candidates.push(parsed.toString().replace(/\/+$/, ''))
    }
  } catch {
    // Let fetch report malformed URLs.
  }
  return [...new Set(candidates)]
}

async function hindsightRequest(path, options = {}) {
  const cfg = config()
  const headers = { ...(options.headers || {}) }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

  let lastError
  for (const baseUrl of baseUrlCandidates(cfg.baseUrl)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()
      let data = text
      if (contentType.includes('application/json') && text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }
      if (!response.ok) {
        const message = data?.error || data?.message || data?.detail || text || response.statusText
        throw new Error(`Hindsight ${response.status}: ${typeof message === 'string' ? message : JSON.stringify(message)}`)
      }
      return data
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

function bankId(args = {}) {
  return encodeURIComponent(String(args.bank_id || args.bankId || config().bankId))
}

function compactJson(value) {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function compactError(error) {
  const text = String(error?.message || error || 'unknown error').replace(/\s+/g, ' ').trim()
  if (!text) return 'unknown error'
  return text.length > 320 ? `${text.slice(0, 317)}...` : text
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean)
  return undefined
}

function memoryItem(args = {}) {
  const content = String(args.content || args.text || args.memory || '').trim()
  if (!content) throw new Error('content is required')

  const item = { content }
  if (args.context) item.context = String(args.context)
  if (args.timestamp) item.timestamp = String(args.timestamp)
  if (args.document_id || args.documentId) item.document_id = String(args.document_id || args.documentId)
  const tags = arrayValue(args.tags)
  if (tags?.length) item.tags = tags
  if (!item.context && args.metadata && typeof args.metadata === 'object') {
    item.context = JSON.stringify(args.metadata)
  }
  return item
}

function recallPayload(args = {}) {
  const query = String(args.query || '').trim()
  if (!query) throw new Error('query is required')
  const payload = { query }
  if (args.budget) payload.budget = String(args.budget)
  if (args.max_tokens || args.maxTokens || args.limit) {
    payload.max_tokens = Number(args.max_tokens || args.maxTokens || args.limit)
  }
  if (args.trace !== undefined) payload.trace = Boolean(args.trace)
  if (args.query_timestamp || args.queryTimestamp) payload.query_timestamp = String(args.query_timestamp || args.queryTimestamp)
  const types = arrayValue(args.types)
  if (types?.length) payload.types = types
  const tags = arrayValue(args.tags)
  if (tags?.length) payload.tags = tags
  if (args.tags_match || args.tagsMatch) payload.tags_match = String(args.tags_match || args.tagsMatch)
  if (args.include && typeof args.include === 'object') payload.include = args.include
  return payload
}

function reflectPayload(args = {}) {
  const query = String(args.query || args.topic || '').trim()
  if (!query) throw new Error('query is required')
  const payload = { query }
  if (args.budget) payload.budget = String(args.budget)
  if (args.max_tokens || args.maxTokens) payload.max_tokens = Number(args.max_tokens || args.maxTokens)
  if (args.context) payload.context = String(args.context)
  if (args.response_schema || args.responseSchema) payload.response_schema = args.response_schema || args.responseSchema
  if (args.include && typeof args.include === 'object') payload.include = args.include
  const tags = arrayValue(args.tags)
  if (tags?.length) payload.tags = tags
  if (args.tags_match || args.tagsMatch) payload.tags_match = String(args.tags_match || args.tagsMatch)
  const factTypes = arrayValue(args.fact_types || args.factTypes)
  if (factTypes?.length) payload.fact_types = factTypes
  if (args.exclude_mental_models !== undefined || args.excludeMentalModels !== undefined) {
    payload.exclude_mental_models = Boolean(args.exclude_mental_models ?? args.excludeMentalModels)
  }
  return payload
}

function formatRecall(data) {
  if (!data || typeof data !== 'object') return compactJson(data)
  const results = Array.isArray(data.results) ? data.results : []
  if (results.length === 0) return `No Hindsight memories found.\n${compactJson(data)}`
  const lines = [`Found ${results.length} Hindsight memory result(s):`]
  for (const [index, item] of results.entries()) {
    const text = String(item.text || item.content || item.summary || '').trim()
    const type = item.type ? ` (${item.type})` : ''
    const id = item.id ? ` id=${item.id}` : ''
    lines.push(`\n---\n${index + 1}.${type}${id}\n${text || compactJson(item)}`)
  }
  if (data.entities && Object.keys(data.entities).length > 0) {
    lines.push(`\nEntities:\n${compactJson(data.entities)}`)
  }
  return lines.join('\n')
}

async function health() {
  try {
    return compactJson(await hindsightRequest('/health'))
  } catch (firstError) {
    try {
      return compactJson(await hindsightRequest('/v1/default/banks'))
    } catch {
      throw firstError
    }
  }
}

async function retain(args) {
  const payload = {
    async: Boolean(args?.async),
    items: [memoryItem(args)],
  }
  const data = await hindsightRequest(`/v1/default/banks/${bankId(args)}/memories`, jsonBody(payload))
  return `Retained Hindsight memory in bank ${decodeURIComponent(bankId(args))}.\n${compactJson(data)}`
}

async function recall(args) {
  const data = await hindsightRequest(`/v1/default/banks/${bankId(args)}/memories/recall`, jsonBody(recallPayload(args)))
  return formatRecall(data)
}

async function reflect(args) {
  const data = await hindsightRequest(`/v1/default/banks/${bankId(args)}/reflect`, jsonBody(reflectPayload(args)))
  if (data && typeof data === 'object' && typeof data.text === 'string') {
    const evidence = data.based_on ? `\n\nBased on:\n${compactJson(data.based_on)}` : ''
    return `${data.text}${evidence}`
  }
  return compactJson(data)
}

async function consolidate(args) {
  const data = await hindsightRequest(`/v1/default/banks/${bankId(args)}/consolidate`, jsonBody({
    deduplicate: args?.deduplicate !== false,
  }))
  return compactJson(data)
}

const tools = [
  {
    name: 'hindsight_health',
    description: 'Check the Hindsight memory API health.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'hindsight_retain',
    description: 'Store durable agent/user/project memory in Hindsight.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        context: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        timestamp: { type: 'string' },
        document_id: { type: 'string' },
        bank_id: { type: 'string' },
        async: { type: 'boolean', default: false },
        metadata: { type: 'object' },
      },
      required: ['content'],
    },
  },
  {
    name: 'hindsight_recall',
    description: 'Retrieve durable memories from Hindsight before answering preference/history/project-memory questions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        bank_id: { type: 'string' },
        budget: { type: 'string', enum: ['low', 'mid', 'high'], default: 'mid' },
        max_tokens: { type: 'number', default: 4096 },
        types: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        tags_match: { type: 'string' },
        trace: { type: 'boolean', default: false },
        include: { type: 'object' },
      },
      required: ['query'],
    },
  },
  {
    name: 'hindsight_reflect',
    description: 'Ask Hindsight to synthesize deeper observations and answers from durable memories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        topic: { type: 'string' },
        bank_id: { type: 'string' },
        budget: { type: 'string', enum: ['low', 'mid', 'high'], default: 'low' },
        max_tokens: { type: 'number', default: 4096 },
        tags: { type: 'array', items: { type: 'string' } },
        fact_types: { type: 'array', items: { type: 'string' } },
        include: { type: 'object' },
        response_schema: { type: 'object' },
      },
    },
  },
  {
    name: 'hindsight_consolidate',
    description: 'Queue Hindsight memory consolidation for the configured bank.',
    inputSchema: {
      type: 'object',
      properties: {
        bank_id: { type: 'string' },
        deduplicate: { type: 'boolean', default: true },
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

  const { CallToolRequestSchema, ListToolsRequestSchema } = types
  const server = new Server(
    { name: 'openclaude-hindsight', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const name = request.params.name
      const args = request.params.arguments || {}
      let text
      if (name === 'hindsight_health') text = await health()
      else if (name === 'hindsight_retain') text = await retain(args)
      else if (name === 'hindsight_recall') text = await recall(args)
      else if (name === 'hindsight_reflect') text = await reflect(args)
      else if (name === 'hindsight_consolidate') text = await consolidate(args)
      else throw new Error(`Unknown tool: ${name}`)
      return { content: [{ type: 'text', text }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: String(error?.stack || compactError(error)) }],
      }
    }
  })

  await server.connect(new StdioServerTransport())
}

main().catch(error => {
  console.error(`[hindsight-mcp-bridge] ${error?.stack || error?.message || error}`)
  process.exit(1)
})
