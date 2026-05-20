import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { randomUUID } from 'crypto'
import type { AgentGatewayConfig } from './config.js'
import {
  buildPromptFromChatMessages,
  normalizeMessageContent,
  runOpenClaudeAgent,
  type AgentRunResult,
} from './agentRunner.js'
import {
  createCronJob,
  deleteCronJob,
  getCronJob,
  listCronJobs,
  pauseCronJob,
  resumeCronJob,
  runCronJobNow,
  updateCronJob,
} from './cron.js'

type AgentApiServerOptions = {
  config: AgentGatewayConfig
  onAgentResponse?: (text: string, source: 'api' | 'run') => void | Promise<void>
}

class AgentApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly errorType = 'invalid_request_error',
  ) {
    super(message)
    this.name = 'AgentApiHttpError'
  }
}

function isAgentApiHttpError(error: unknown): error is AgentApiHttpError {
  return error instanceof AgentApiHttpError
}

type SseEvent = Record<string, unknown> | null

class SseQueue {
  private readonly events: SseEvent[] = []
  private waiters: Array<(event: SseEvent) => void> = []

  push(event: SseEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    this.events.push(event)
  }

  next(timeoutMs: number): Promise<SseEvent | 'timeout'> {
    const event = this.events.shift()
    if (event !== undefined) return Promise.resolve(event)

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index !== -1) this.waiters.splice(index, 1)
        resolve('timeout')
      }, timeoutMs)
      const waiter = (nextEvent: SseEvent) => {
        clearTimeout(timer)
        resolve(nextEvent)
      }
      this.waiters.push(waiter)
    })
  }
}

type FrontmatterStreamStripper = {
  push: (chunk: string) => string
  flush: () => string
}

export class AgentApiServer {
  private readonly config: AgentGatewayConfig
  private readonly onAgentResponse?: AgentApiServerOptions['onAgentResponse']
  private server: Server | undefined
  private readonly responseStore = new Map<string, Record<string, unknown>>()
  private readonly responseOrder: string[] = []
  private readonly conversationLatest = new Map<string, string>()
  private readonly chatSessions = new Map<string, ConversationMessage[]>()
  private readonly chatSessionOrder: string[] = []
  private readonly runs = new Map<string, SseQueue>()

  constructor(options: AgentApiServerOptions) {
    this.config = options.config
    this.onAgentResponse = options.onAgentResponse
  }

  async start(): Promise<void> {
    if (this.server) return
    this.validateExposure()

    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(error => {
        if (response.headersSent) {
          response.end()
          return
        }
        if (isAgentApiHttpError(error)) {
          this.writeJson(
            response,
            error.statusCode,
            openAiError(error.message, error.errorType),
          )
          return
        }
        this.writeJson(response, 500, openAiError(String(error), 'server_error'))
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.config.api.port, this.config.api.host, () => {
        this.server!.off('error', reject)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = undefined
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  get url(): string {
    const address = this.server?.address()
    if (address && typeof address !== 'string') {
      const host =
        address.address === '::' || address.address === '0.0.0.0'
          ? '127.0.0.1'
          : address.address
      return `http://${host}:${(address as AddressInfo).port}`
    }
    return `http://${this.config.api.host}:${this.config.api.port}`
  }

  private validateExposure(): void {
    const host = this.config.api.host
    const isLocalhost =
      host === '127.0.0.1' || host === 'localhost' || host === '::1'
    if (!isLocalhost && !this.config.api.apiKey) {
      throw new Error(
        'Agent API refuses to bind outside localhost without an API key',
      )
    }
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method || 'GET'
    const url = new URL(request.url || '/', this.url)

    if (method === 'OPTIONS') {
      this.writeCors(response, 204)
      return
    }

    if (url.pathname === '/health' || url.pathname === '/v1/health') {
      this.writeJson(response, 200, {
        status: 'ok',
        platform: 'openclaude-agent',
        api: this.config.api.enabled,
        cron: this.config.cron.enabled,
        telegram: this.config.telegram.enabled,
      })
      return
    }

    if (isProtectedApiPath(url.pathname)) {
      if (!this.checkAuth(request, response)) return
    }

    const apiPath = normalizeOpenAiPath(url.pathname)

    if (method === 'GET' && apiPath === '/models') {
      this.writeJson(response, 200, {
        object: 'list',
        data: [this.modelPayload()],
      })
      return
    }

    const modelMatch = apiPath.match(/^\/models\/([^/]+)$/)
    if (modelMatch && method === 'GET') {
      const requestedModel = decodeURIComponent(modelMatch[1] || '')
      if (requestedModel && requestedModel !== this.config.api.modelName) {
        this.writeJson(response, 404, openAiError('Model not found'))
        return
      }
      this.writeJson(response, 200, this.modelPayload())
      return
    }

    if (method === 'POST' && apiPath === '/chat/completions') {
      await this.handleChatCompletions(request, response)
      return
    }

    if (method === 'POST' && apiPath === '/responses') {
      await this.handleResponses(request, response)
      return
    }

    const responseMatch = apiPath.match(/^\/responses\/([^/]+)$/)
    if (responseMatch && method === 'GET') {
      const stored = this.responseStore.get(responseMatch[1]!)
      if (!stored) {
        this.writeJson(response, 404, openAiError('Response not found'))
        return
      }
      this.writeJson(response, 200, stored.response)
      return
    }
    if (responseMatch && method === 'DELETE') {
      const deleted = this.responseStore.delete(responseMatch[1]!)
      if (deleted) {
        this.forgetStoredResponse(responseMatch[1]!)
      }
      this.writeJson(response, deleted ? 200 : 404, {
        id: responseMatch[1],
        object: 'response',
        deleted,
      })
      return
    }

    if (method === 'POST' && apiPath === '/runs') {
      await this.handleRuns(request, response)
      return
    }

    const runMatch = apiPath.match(/^\/runs\/([^/]+)\/events$/)
    if (runMatch && method === 'GET') {
      await this.handleRunEvents(runMatch[1]!, response)
      return
    }

    if (url.pathname === '/api/jobs') {
      if (method === 'GET') {
        this.writeJson(response, 200, { jobs: await listCronJobs(true) })
        return
      }
      if (method === 'POST') {
        const body = await this.readJson(request)
        const job = await createCronJob(body as Record<string, unknown>)
        this.writeJson(response, 201, { job })
        return
      }
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/)
    if (jobMatch) {
      await this.handleJobRoute(method, jobMatch[1]!, jobMatch[2], request, response)
      return
    }

    this.writeJson(response, 404, openAiError('Not found'))
  }

  private async handleChatCompletions(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await this.readJson(request)
    const messages = Array.isArray(body.messages) ? body.messages : null
    if (!messages) {
      this.writeJson(response, 400, openAiError("Missing or invalid 'messages'"))
      return
    }

    const chatInput = buildChatCompletionInput(messages)
    if (!chatInput.currentUser.content.trim()) {
      this.writeJson(response, 400, openAiError('No user message found'))
      return
    }
    const requestedSessionId = getHeaderValue(request, 'x-hermes-session-id')
    const sessionId = requestedSessionId || randomUUID()
    const sessionHistory = requestedSessionId
      ? this.chatSessions.get(sessionId)
      : undefined
    const history = sessionHistory || chatInput.history
    const promptMessages = buildChatPromptMessages({
      systemMessages: chatInput.systemMessages,
      history,
      currentUser: chatInput.currentUser,
    })
    const { prompt: runnerPrompt } = buildPromptFromChatMessages(promptMessages)
    if (!runnerPrompt.trim()) {
      this.writeJson(response, 400, openAiError('No user message found'))
      return
    }

    const id = `chatcmpl-${randomUUID().replace(/-/g, '')}`
    const model = String(body.model || this.config.api.modelName)

    if (body.stream) {
      await this.streamChatCompletion(response, id, model, runnerPrompt, {
        includeUsage: shouldIncludeStreamUsage(body),
        sessionId,
        history,
        currentUser: chatInput.currentUser,
      })
      return
    }

    const result = await runOpenClaudeAgent({
      prompt: runnerPrompt,
      config: this.config,
    })
    if (result.exitCode !== 0) {
      this.writeJson(
        response,
        500,
        openAiError(formatAgentFailureForApi(result), 'server_error'),
      )
      return
    }

    const responseText = normalizeAgentResponseText(result.text)

    this.storeChatSession(sessionId, [
      ...history,
      chatInput.currentUser,
      { role: 'assistant', content: responseText },
    ])
    await this.onAgentResponse?.(responseText, 'api')
    this.writeJson(
      response,
      200,
      {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: responseText },
            finish_reason: 'stop',
          },
        ],
        usage: emptyUsage(),
      },
      { 'X-Hermes-Session-Id': sessionId },
    )
  }

  private async streamChatCompletion(
    response: ServerResponse,
    id: string,
    model: string,
    prompt: string,
    options: {
      includeUsage?: boolean
      sessionId?: string
      history?: ConversationMessage[]
      currentUser?: ConversationMessage
    } = {},
  ): Promise<void> {
    const abortController = new AbortController()
    let completed = false
    response.on('close', () => {
      if (!completed) abortController.abort()
    })

    response.writeHead(200, {
      ...this.corsHeaders(),
      ...(options.sessionId ? { 'X-Hermes-Session-Id': options.sessionId } : {}),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const created = Math.floor(Date.now() / 1000)
    const writeChunk = (delta: Record<string, unknown>) => {
      response.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: null }],
        })}\n\n`,
      )
    }

    writeChunk({ role: 'assistant' })
    let fullText = ''
    const frontmatterStripper = createFrontmatterStreamStripper()
    const result = await runOpenClaudeAgent({
      prompt,
      config: this.config,
      signal: abortController.signal,
      onStdout: chunk => {
        fullText += chunk
        if (response.destroyed) return
        const visibleChunk = frontmatterStripper.push(chunk)
        if (visibleChunk) {
          writeChunk({ content: visibleChunk })
        }
      },
    })

    if (response.destroyed) return

    if (result.exitCode !== 0 && !fullText) {
      writeChunk({ content: formatAgentFailureForApi(result) })
    }

    const trailingVisibleChunk = frontmatterStripper.flush()
    if (trailingVisibleChunk && !response.destroyed) {
      writeChunk({ content: trailingVisibleChunk })
    }

    const finishChunk: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }
    if (options.includeUsage) {
      finishChunk.usage = emptyUsage()
    }
    response.write(`data: ${JSON.stringify(finishChunk)}\n\n`)
    response.write('data: [DONE]\n\n')
    completed = true
    response.end()
    const normalizedFullText = normalizeAgentResponseText(fullText)
    if (normalizedFullText) {
      if (options.sessionId && options.currentUser) {
        this.storeChatSession(options.sessionId, [
          ...(options.history || []),
          options.currentUser,
          { role: 'assistant', content: normalizedFullText },
        ])
      }
      await this.onAgentResponse?.(normalizedFullText, 'api')
    }
  }

  private async handleResponses(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await this.readJson(request)
    const input = body.input
    if (input === undefined || input === null) {
      this.writeJson(response, 400, openAiError("Missing 'input'"))
      return
    }

    const prompt = normalizeResponsesInput(input)
    if (!prompt.trim()) {
      this.writeJson(response, 400, openAiError('No user message found'))
      return
    }

    const instructions =
      typeof body.instructions === 'string' ? body.instructions.trim() : ''
    const conversation =
      typeof body.conversation === 'string' ? body.conversation.trim() : ''
    const previousResponseId = this.resolvePreviousResponseId(body)
    const previous = previousResponseId
      ? this.responseStore.get(previousResponseId)
      : undefined
    if (previousResponseId && !previous) {
      this.writeJson(response, 404, openAiError('Previous response not found'))
      return
    }

    const explicitHistory = normalizeConversationHistory(body.conversation_history)
    const previousHistory = explicitHistory.length
      ? explicitHistory
      : normalizeConversationHistory(previous?.conversation_history)
    const runnerPrompt = buildResponsesRunnerPrompt({
      instructions,
      previousHistory,
      prompt,
    })
    const result = await runOpenClaudeAgent({
      prompt: runnerPrompt,
      config: this.config,
    })
    if (result.exitCode !== 0) {
      this.writeJson(
        response,
        500,
        openAiError(formatAgentFailureForApi(result), 'server_error'),
      )
      return
    }

    const responseText = normalizeAgentResponseText(result.text)

    const responseId = `resp_${randomUUID().replace(/-/g, '')}`
    const data = {
      id: responseId,
      object: 'response',
      status: 'completed',
      created_at: Math.floor(Date.now() / 1000),
      model: String(body.model || this.config.api.modelName),
      previous_response_id: previousResponseId || null,
      ...(conversation ? { conversation } : {}),
      output: [
        {
          id: `msg_${randomUUID().replace(/-/g, '')}`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: responseText }],
        },
      ],
      usage: emptyUsage(),
    }

    if (body.store !== false) {
      this.storeResponse(responseId, {
        response: data,
        conversation_history: [
          ...previousHistory,
          { role: 'user', content: prompt },
          { role: 'assistant', content: responseText },
        ],
        instructions,
        previous_response_id: previousResponseId || undefined,
        conversation: conversation || undefined,
      })
    }

    await this.onAgentResponse?.(responseText, 'api')
    this.writeJson(response, 200, data)
  }

  private async handleRuns(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await this.readJson(request)
    const input = body.input
    if (input === undefined || input === null) {
      this.writeJson(response, 400, openAiError("Missing 'input'"))
      return
    }

    const runId = `run_${randomUUID().replace(/-/g, '')}`
    const queue = new SseQueue()
    this.runs.set(runId, queue)
    const prompt = normalizeResponsesInput(input)
    const instructions =
      typeof body.instructions === 'string' ? body.instructions.trim() : ''

    void runOpenClaudeAgent({
      prompt: instructions ? `${instructions}\n\n${prompt}` : prompt,
      config: this.config,
      onStdout: chunk => {
        queue.push({
          event: 'message.delta',
          run_id: runId,
          timestamp: Date.now() / 1000,
          delta: chunk,
        })
      },
    }).then(
      async result => {
        const responseText = normalizeAgentResponseText(result.text)
        if (result.exitCode === 0) {
          queue.push({
            event: 'run.completed',
            run_id: runId,
            timestamp: Date.now() / 1000,
            output: responseText,
            usage: emptyUsage(),
          })
          await this.onAgentResponse?.(responseText, 'run')
        } else {
          queue.push({
            event: 'run.failed',
            run_id: runId,
            timestamp: Date.now() / 1000,
            error: formatAgentFailureForApi(result),
          })
        }
        queue.push(null)
      },
      error => {
        queue.push({
          event: 'run.failed',
          run_id: runId,
          timestamp: Date.now() / 1000,
          error: String(error),
        })
        queue.push(null)
      },
    )

    this.writeJson(response, 202, { run_id: runId, status: 'started' })
  }

  private async handleRunEvents(
    runId: string,
    response: ServerResponse,
  ): Promise<void> {
    const queue = this.runs.get(runId)
    if (!queue) {
      this.writeJson(response, 404, openAiError('Run not found'))
      return
    }

    response.writeHead(200, {
      ...this.corsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    while (!response.destroyed) {
      const event = await queue.next(30_000)
      if (event === 'timeout') {
        response.write(': keepalive\n\n')
        continue
      }
      if (event === null) {
        response.write(': stream closed\n\n')
        break
      }
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    this.runs.delete(runId)
    response.end()
  }

  private async handleJobRoute(
    method: string,
    jobId: string,
    action: string | undefined,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!action && method === 'GET') {
      const job = await getCronJob(jobId)
      this.writeJson(response, job ? 200 : 404, job ? { job } : openAiError('Job not found'))
      return
    }
    if (!action && method === 'PATCH') {
      const body = await this.readJson(request)
      const job = await updateCronJob(jobId, body as Record<string, unknown>)
      this.writeJson(response, job ? 200 : 404, job ? { job } : openAiError('Job not found'))
      return
    }
    if (!action && method === 'DELETE') {
      const deleted = await deleteCronJob(jobId)
      this.writeJson(response, deleted ? 200 : 404, { deleted })
      return
    }
    if (action === 'pause' && method === 'POST') {
      const job = await pauseCronJob(jobId)
      this.writeJson(response, job ? 200 : 404, job ? { job } : openAiError('Job not found'))
      return
    }
    if (action === 'resume' && method === 'POST') {
      const job = await resumeCronJob(jobId)
      this.writeJson(response, job ? 200 : 404, job ? { job } : openAiError('Job not found'))
      return
    }
    if ((action === 'run' || action === 'trigger') && method === 'POST') {
      const job = await runCronJobNow(jobId, this.config)
      this.writeJson(response, job ? 200 : 404, job ? { job, ran: true } : openAiError('Job not found'))
      return
    }

    this.writeJson(response, 404, openAiError('Not found'))
  }

  private modelPayload(): Record<string, unknown> {
    return {
      id: this.config.api.modelName,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'openclaude',
      root: this.config.api.modelName,
      parent: null,
    }
  }

  private storeChatSession(
    sessionId: string,
    history: ConversationMessage[],
  ): void {
    if (!this.chatSessions.has(sessionId)) {
      this.chatSessionOrder.push(sessionId)
    }
    this.chatSessions.set(sessionId, normalizeConversationHistory(history))

    while (this.chatSessionOrder.length > 100) {
      const oldest = this.chatSessionOrder.shift()
      if (!oldest) break
      this.chatSessions.delete(oldest)
    }
  }

  private resolvePreviousResponseId(body: Record<string, any>): string {
    const explicit =
      typeof body.previous_response_id === 'string'
        ? body.previous_response_id.trim()
        : ''
    if (explicit) return explicit
    const conversation =
      typeof body.conversation === 'string' ? body.conversation.trim() : ''
    return conversation ? this.conversationLatest.get(conversation) || '' : ''
  }

  private storeResponse(
    responseId: string,
    payload: Record<string, unknown>,
  ): void {
    this.responseStore.set(responseId, payload)
    this.responseOrder.push(responseId)

    const conversation = String(payload.conversation || '').trim()
    if (conversation) {
      this.conversationLatest.set(conversation, responseId)
    }

    while (this.responseOrder.length > 100) {
      const oldest = this.responseOrder.shift()
      if (!oldest) break
      this.responseStore.delete(oldest)
      this.forgetStoredResponse(oldest)
    }
  }

  private forgetStoredResponse(responseId: string): void {
    const index = this.responseOrder.indexOf(responseId)
    if (index !== -1) this.responseOrder.splice(index, 1)
    for (const [conversation, latestId] of this.conversationLatest) {
      if (latestId === responseId) {
        this.conversationLatest.delete(conversation)
      }
    }
  }

  private checkAuth(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    const apiKey = this.config.api.apiKey
    if (!apiKey) return true

    const auth = request.headers.authorization || ''
    if (auth.startsWith('Bearer ') && auth.slice(7).trim() === apiKey) {
      return true
    }

    this.writeJson(response, 401, openAiError('Invalid API key'))
    return false
  }

  private async readJson(request: IncomingMessage): Promise<Record<string, any>> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > 1_000_000) {
        throw new AgentApiHttpError(413, 'Request body too large')
      }
      chunks.push(buffer)
    }
    if (!chunks.length) return {}
    const raw = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
    try {
      return JSON.parse(raw)
    } catch {
      throw new AgentApiHttpError(400, 'Invalid JSON request body')
    }
  }

  private writeCors(response: ServerResponse, status: number): void {
    response.writeHead(status, this.corsHeaders())
    response.end()
  }

  private writeJson(
    response: ServerResponse,
    status: number,
    payload: unknown,
    headers: Record<string, string> = {},
  ): void {
    response.writeHead(status, {
      ...this.corsHeaders(),
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    })
    response.end(JSON.stringify(payload))
  }

  private corsHeaders(): Record<string, string> {
    const origins = this.config.api.corsOrigins
    const allowOrigin = origins.includes('*') ? '*' : origins[0]
    if (!allowOrigin) return {}
    return {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
      'Access-Control-Expose-Headers': 'X-Hermes-Session-Id',
    }
  }
}

function openAiError(
  message: string,
  type = 'invalid_request_error',
): { error: { message: string; type: string } } {
  return { error: { message, type } }
}

function formatAgentFailureForApi(result: AgentRunResult): string {
  const lines = ['Agent run failed.']
  if (result.failureKind) {
    lines.push(`Failure kind: ${result.failureKind}`)
  }
  if (result.timedOut) {
    lines.push(`Timed out after ${formatDuration(result.durationMs || 0)}.`)
  } else {
    lines.push(`Exit code: ${result.exitCode}.`)
  }
  if (result.diagnostic) {
    lines.push('', result.diagnostic)
  }
  if (result.stderr) {
    lines.push('', 'Stderr:', result.stderr.slice(0, 2500))
  }
  const activity = result.activity?.slice(-8) || []
  if (activity.length > 0 && !result.diagnostic?.includes('Recent activity:')) {
    lines.push('', 'Recent activity:')
    for (const event of activity) {
      lines.push(`- ${event}`)
    }
  }
  return lines.join('\n').slice(0, 4000)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function emptyUsage(): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
}

type ConversationMessage = {
  role: string
  content: string
}

function normalizeOpenAiPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/v1' || path === '/api/v1') return '/'
  if (path.startsWith('/v1/')) return path.slice(3)
  if (path.startsWith('/api/v1/')) return path.slice(7)
  return path
}

function isProtectedApiPath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true
  const path = normalizeOpenAiPath(pathname)
  return (
    path === '/models' ||
    path.startsWith('/models/') ||
    path === '/chat/completions' ||
    path === '/responses' ||
    path.startsWith('/responses/') ||
    path === '/runs' ||
    path.startsWith('/runs/')
  )
}

function getHeaderValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name]
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

function shouldIncludeStreamUsage(body: Record<string, any>): boolean {
  const streamOptions = body.stream_options
  return Boolean(
    streamOptions &&
      typeof streamOptions === 'object' &&
      streamOptions.include_usage,
  )
}

function buildChatCompletionInput(messages: unknown[]): {
  systemMessages: string[]
  history: ConversationMessage[]
  currentUser: ConversationMessage
} {
  const systemMessages: string[] = []
  const conversation: ConversationMessage[] = []

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const message = raw as Record<string, unknown>
    const role = String(message.role || '').trim()
    const content = normalizeMessageContent(message.content).trim()
    if (!content) continue

    if (role === 'system') {
      systemMessages.push(content)
    } else if (role === 'assistant' || role === 'user') {
      conversation.push({ role, content })
    }
  }

  const currentUserIndex = findLastIndex(
    conversation,
    message => message.role === 'user',
  )
  if (currentUserIndex === -1) {
    return {
      systemMessages,
      history: conversation,
      currentUser: { role: 'user', content: '' },
    }
  }

  return {
    systemMessages,
    history: conversation.slice(0, currentUserIndex),
    currentUser: conversation[currentUserIndex]!,
  }
}

function buildChatPromptMessages(input: {
  systemMessages: string[]
  history: ConversationMessage[]
  currentUser: ConversationMessage
}): Array<Record<string, string>> {
  return [
    ...input.systemMessages.map(content => ({ role: 'system', content })),
    ...input.history.map(message => ({
      role: message.role,
      content: message.content,
    })),
    { role: input.currentUser.role, content: input.currentUser.content },
  ]
}

function findLastIndex<T>(
  items: T[],
  predicate: (item: T) => boolean,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index
  }
  return -1
}

function normalizeConversationHistory(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return undefined
      const record = item as Record<string, unknown>
      const role = String(record.role || '').trim()
      const content = String(record.content || '').trim()
      if (!role || !content) return undefined
      return { role, content }
    })
    .filter((item): item is ConversationMessage => Boolean(item))
}

function buildResponsesRunnerPrompt(input: {
  instructions: string
  previousHistory: ConversationMessage[]
  prompt: string
}): string {
  const parts: string[] = []
  if (input.instructions) parts.push(input.instructions)
  if (input.previousHistory.length > 0) {
    parts.push(
      [
        'Previous response conversation context:',
        ...input.previousHistory.map(
          message => `${message.role}: ${message.content}`,
        ),
      ].join('\n'),
    )
  }
  parts.push(input.prompt)
  return parts.join('\n\n')
}

function normalizeResponsesInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (!Array.isArray(input)) return String(input ?? '')

  return input
    .map(item => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      const role = String(record.role || 'user')
      return `${role}: ${normalizeMessageContent(record.content)}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function normalizeAgentResponseText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('---')) {
    return trimmed
  }

  const stripped = trimmed.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)*/u, '')
  return stripped.trim() || trimmed
}

function createFrontmatterStreamStripper(): FrontmatterStreamStripper {
  let buffer = ''
  let decided = false

  return {
    push(chunk: string): string {
      if (decided) {
        return chunk
      }

      buffer += chunk
      if (!buffer.startsWith('---')) {
        decided = true
        const visible = buffer
        buffer = ''
        return visible
      }

      const match = buffer.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)*/u)
      if (match) {
        decided = true
        buffer = buffer.slice(match[0].length)
        const visible = buffer
        buffer = ''
        return visible
      }

      if (buffer.length > 16_384) {
        decided = true
        const visible = buffer
        buffer = ''
        return visible
      }

      return ''
    },
    flush(): string {
      if (!buffer) {
        return ''
      }

      const visible = decided ? buffer : normalizeAgentResponseText(buffer)
      buffer = ''
      decided = true
      return visible
    },
  }
}
