import { existsSync, readFileSync } from 'fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import stripAnsi from 'strip-ansi'
import { isInBundledMode } from '../../utils/bundledMode.js'
import type { AgentGatewayConfig } from './config.js'

export type AgentRunOptions = {
  prompt: string
  cwd?: string
  config: AgentGatewayConfig
  onStdout?: (chunk: string) => void
  onProgress?: (event: string) => void
  streamEvents?: boolean
  signal?: AbortSignal
  suppressObservers?: boolean
}

export type AgentRunResult = {
  text: string
  stderr: string
  exitCode: number
  timedOut: boolean
  durationMs?: number
  activity?: string[]
  failureKind?: AgentRunFailureKind
  diagnostic?: string
}

export type AgentRunFailureKind =
  | 'timeout'
  | 'rate_limit'
  | 'auth'
  | 'model_not_found'
  | 'provider_request'
  | 'max_turns'
  | 'tool_error'
  | 'execution'
  | 'unknown'

export type StreamProgressContext = {
  toolUseById: Map<string, string>
}

export type AgentRunObserverContext = {
  prompt: string
  cwd: string
  startedAt: number
}

export type AgentRunObserver = {
  onStart?: (context: AgentRunObserverContext) => void | Promise<void>
  onFinish?: (
    context: AgentRunObserverContext,
    result: AgentRunResult,
  ) => void | Promise<void>
}

const agentRunObservers = new Set<AgentRunObserver>()
const CURRENT_FILE = fileURLToPath(import.meta.url)
const WINDOWS_SHUTDOWN_ASSERT_RE =
  /Assertion failed:\s*!\(handle->flags & UV_HANDLE_CLOSING\)/i
const API_GATEWAY_APPEND_SYSTEM_PROMPT = [
  'You are running behind an API gateway.',
  'Do not assume the user is asking about the current repository unless they explicitly mention code, files, the repo, or the project.',
  'Answer directly and finish the turn as soon as the user request is satisfied.',
  'Use existing knowledge for stable facts when possible.',
  'Only invoke tools when the user explicitly asks you to act, inspect local state, or when tool use is necessary to complete the task.',
  'When invoking tools, pass JSON arguments that exactly match the tool schema. For Write, always provide both file_path and content. For Edit, always provide file_path, old_string, and new_string.',
  'If a tool returns an input validation error, retry once with corrected arguments before giving up.',
  'Never claim a local action is complete unless the relevant tool call succeeded. If a tool fails, report the exact failure.',
  'For desktop, screenshot, application-window, filesystem, or automation requests, inspect the real local environment with available tools and report tool failures explicitly.',
  'Avoid exploratory web search unless the request requires up-to-date verification.',
].join(' ')
const OPENRAG_APPEND_SYSTEM_PROMPT = [
  'OpenRAG RAG may be available through MCP tools.',
  'When the user asks about ingested documents, a knowledge base, project knowledge, long-term knowledge, RAG, OpenRAG, or document-grounded answers, prefer OpenRAG tools before answering from memory.',
  'Use openrag_search first for retrieval, then answer from the returned chunks yourself.',
  'Use openrag_ingest_file when the user asks to add a local document to the knowledge base.',
  'Use openrag_chat only as an optional convenience; if it fails, fall back to openrag_search and continue from the retrieved evidence.',
  'If OpenRAG tools are unavailable or fail, say that clearly and continue with local tools only when they are appropriate for the request.',
  'Do not fabricate retrieved evidence or claim a RAG lookup happened unless the tool call succeeded.',
].join(' ')
const CAMOFOX_APPEND_SYSTEM_PROMPT = [
  'Camofox browser may be available through MCP tools named camofox_*.',
  'For real web browsing, anti-bot pages, browser screenshots, clicking/typing in pages, or page snapshots, prefer Camofox tools when they are available.',
  'Use camofox_create_tab first, then camofox_snapshot to get stable element refs, then camofox_click/camofox_type/camofox_press/camofox_scroll as needed.',
  'Use camofox_screenshot when the user asks for a browser screenshot; it saves a local PNG path.',
  'If Camofox is unavailable, report that clearly and fall back to other available browser or web tools when appropriate.',
].join(' ')
const HINDSIGHT_APPEND_SYSTEM_PROMPT = [
  'Hindsight durable memory may be available through MCP tools named hindsight_*.',
  'Use Hindsight for long-term user preferences, project decisions, recurring failures, learned operating procedures, and agent self-knowledge that should survive across sessions.',
  'Before answering questions about prior decisions, remembered preferences, history, durable memory, or learned project behavior, call hindsight_recall when it is available.',
  'After completing meaningful work, learning a stable preference, fixing a recurring bug, or changing how this agent should operate, call hindsight_retain with compact content and useful tags.',
  'Use hindsight_reflect for synthesis, background consciousness summaries, evolution reviews, and deeper analysis over retained memories.',
  'Do not claim that memory was read or saved unless the Hindsight tool call succeeded.',
].join(' ')
const IGNORABLE_STDERR_PATTERNS = [
  WINDOWS_SHUTDOWN_ASSERT_RE,
  /^\(node:\d+\)\s+\[DEP\d+\]\s+DeprecationWarning:/i,
  /^\(Use `node --trace-deprecation .*$/i,
  /^\[web-search\]\s+/i,
]

export function addAgentRunObserver(observer: AgentRunObserver): () => void {
  agentRunObservers.add(observer)
  return () => {
    agentRunObservers.delete(observer)
  }
}

function getCliInvocation(): { command: string; args: string[] } {
  if (process.env.OPENCLAUDE_AGENT_GATEWAY_COMMAND) {
    const parts = splitCommandLine(process.env.OPENCLAUDE_AGENT_GATEWAY_COMMAND)
    if (parts.length > 0) {
      return {
        command: parts[0],
        args: parts.slice(1),
      }
    }
    return {
      command: process.env.OPENCLAUDE_AGENT_GATEWAY_COMMAND,
      args: [],
    }
  }

  if (isInBundledMode()) {
    return { command: process.execPath, args: [] }
  }

  const script = process.argv[1]
  if (script && script !== '[stdin]' && existsSync(script)) {
    return { command: process.execPath, args: [script] }
  }

  const currentDir = dirname(CURRENT_FILE)
  const distEntry = resolve(currentDir, '../../../dist/cli.mjs')
  if (existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry] }
  }

  const fallbackEntries = [
    resolve(currentDir, '../../cli.mjs'),
    resolve(currentDir, '../../entrypoints/cli.tsx'),
  ]
  for (const entry of fallbackEntries) {
    if (existsSync(entry)) {
      return { command: process.execPath, args: [entry] }
    }
  }

  return { command: process.execPath, args: [] }
}

function splitCommandLine(value: string): string[] {
  const parts: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g
  for (const match of value.matchAll(pattern)) {
    parts.push(match[1] ?? match[2] ?? match[0])
  }
  return parts
}

export function buildAgentArgs(
  config: AgentGatewayConfig,
  options: { streamEvents?: boolean } = {},
): string[] {
  const args = [
    '--print',
    ...(options.streamEvents ? ['--verbose'] : []),
    '--output-format',
    options.streamEvents ? 'stream-json' : 'text',
    '--append-system-prompt',
    getApiGatewayAppendSystemPrompt(config),
    '--max-turns',
    String(config.runner.maxTurns),
  ]

  if (config.runner.permissionMode === 'acceptEdits') {
    args.push('--permission-mode', 'acceptEdits')
  } else if (config.runner.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions')
  }

  if (config.runner.availableTools.length > 0) {
    args.push('--tools', config.runner.availableTools.join(','))
  }

  if (config.runner.disallowedTools.length > 0) {
    args.push('--disallowedTools', config.runner.disallowedTools.join(','))
  }

  return args
}

function getApiGatewayAppendSystemPrompt(config: AgentGatewayConfig): string {
  const hasOpenRAG =
    config.openRAG.enabled ||
    config.openRAG.mcpEnabled ||
    Boolean(config.openRAG.apiKey)
  const parts = [API_GATEWAY_APPEND_SYSTEM_PROMPT]
  if (hasOpenRAG) parts.push(OPENRAG_APPEND_SYSTEM_PROMPT)
  parts.push(CAMOFOX_APPEND_SYSTEM_PROMPT)
  parts.push(HINDSIGHT_APPEND_SYSTEM_PROMPT)
  return parts.join('\n\n')
}

function parseDotEnvFile(cwd: string): NodeJS.ProcessEnv {
  const envPath = resolve(cwd, '.env')
  if (!existsSync(envPath)) return {}

  const parsed: NodeJS.ProcessEnv = {}
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u)
    if (!match) continue

    const key = match[1]
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

export function buildAgentChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): NodeJS.ProcessEnv {
  const dotEnv = parseDotEnvFile(cwd)
  const childEnv: NodeJS.ProcessEnv = {
    ...dotEnv,
    ...baseEnv,
    OPENCLAUDE_AGENT_GATEWAY_CHILD: '1',
    NO_COLOR: baseEnv.NO_COLOR ?? '1',
  }
  // MCP/RAG credentials are managed by this project/GUI. Prefer the local
  // .env value over stale shell or user-level Windows environment values.
  for (const key of [
    'MCPR_TOKEN',
    'MCPR_HOST',
    'MCPR_PORT',
    'OPENRAG_URL',
    'OPENRAG_API_KEY',
    'OPENRAG_MCP_TIMEOUT',
    'OPENRAG_MCP_MAX_CONNECTIONS',
    'OPENRAG_MCP_MAX_KEEPALIVE_CONNECTIONS',
    'OPENRAG_MCP_MAX_RETRIES',
    'OPENRAG_MCP_FOLLOW_REDIRECTS',
    'CAMOFOX_URL',
    'CAMOFOX_PORT',
    'CAMOFOX_ACCESS_KEY',
    'CAMOFOX_API_KEY',
    'CAMOFOX_MCP_USER_ID',
    'CAMOFOX_MCP_SESSION_KEY',
    'CAMOFOX_MCP_TIMEOUT',
    'HINDSIGHT_URL',
    'HINDSIGHT_API_KEY',
    'HINDSIGHT_BANK_ID',
    'HINDSIGHT_MCP_TIMEOUT',
  ]) {
    if (dotEnv[key]) {
      childEnv[key] = dotEnv[key]
    }
  }
  const providerKeys = [
    'OPENCLAUDE_RESPECT_PROVIDER_ENV',
    'OPENCLAUDE_PROVIDER',
    'OPENCLAUDE_BASE_URL',
    'OPENCLAUDE_MODEL',
    'OPENCLAUDE_API_KEY',
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_MISTRAL',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'OPENAI_API_KEY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_API_KEY',
    'GEMINI_BASE_URL',
    'GEMINI_MODEL',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'MISTRAL_BASE_URL',
    'MISTRAL_MODEL',
    'MISTRAL_API_KEY',
    'CODEX_API_KEY',
    'CODEX_CREDENTIAL_SOURCE',
    'CHATGPT_ACCOUNT_ID',
    'CODEX_ACCOUNT_ID',
  ]
  const preferDotEnvProvider =
    dotEnv.OPENCLAUDE_RESPECT_PROVIDER_ENV === '1' ||
    baseEnv.OPENCLAUDE_RESPECT_PROVIDER_ENV === '1'
  if (preferDotEnvProvider) {
    for (const key of providerKeys) {
      if (dotEnv[key] !== undefined) {
        childEnv[key] = dotEnv[key]
      }
    }
  }
  if (childEnv.MCPR_TOKEN) {
    childEnv.MCPR_HOST = childEnv.MCPR_HOST || '127.0.0.1'
    childEnv.MCPR_PORT = childEnv.MCPR_PORT || '3282'
  }
  delete childEnv.OPENCLAUDE_AGENT_GATEWAY_SERVER
  return childEnv
}

function killProcessTree(proc: ChildProcessWithoutNullStreams): void {
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {})
      proc.kill('SIGTERM')
      return
    }

    proc.kill('SIGTERM')
  } catch {
    // Best effort; the process may already be gone.
  }
}

export function runOpenClaudeAgent(
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  return new Promise(resolve => {
    const invocation = getCliInvocation()
    const args = [
      ...invocation.args,
      ...buildAgentArgs(options.config, { streamEvents: options.streamEvents }),
    ]
    const cwd = options.cwd || options.config.runner.cwd || process.cwd()
    const observerContext: AgentRunObserverContext = {
      prompt: options.prompt,
      cwd,
      startedAt: Date.now(),
    }
    let textStdout = ''
    let rawStdout = ''
    let streamLineBuffer = ''
    let streamResultText = ''
    let streamResultError = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timeoutTimer: ReturnType<typeof setTimeout>
    let forceResolveTimer: ReturnType<typeof setTimeout> | undefined
    const activity: string[] = []
    const seenProgress = new Set<string>()
    const progressContext: StreamProgressContext = {
      toolUseById: new Map(),
    }

    const recordProgress = (label: string) => {
      const normalized = redactAgentText(stripAnsi(label)).replace(/\s+/g, ' ').trim()
      if (!normalized) return
      const truncated = normalized.length > 220
        ? `${normalized.slice(0, 217)}...`
        : normalized
      if (seenProgress.has(truncated)) return
      seenProgress.add(truncated)
      activity.push(truncated)
      while (activity.length > 60) activity.shift()
      options.onProgress?.(truncated)
    }

    const handleStreamLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      const message = parseStreamJsonLine(trimmed)
      if (!message) {
        textStdout += `${line}\n`
        options.onStdout?.(stripAnsi(line) + '\n')
        return
      }

      for (const event of summarizeStreamJsonProgress(message, progressContext)) {
        recordProgress(event)
      }

      const result = extractStreamJsonResult(message)
      if (result) {
        streamResultText = result.text
        streamResultError = result.error
      }
    }

    const handleStdoutChunk = (chunk: string) => {
      const cleanChunk = stripAnsi(chunk)
      rawStdout += cleanChunk
      if (!options.streamEvents) {
        textStdout += cleanChunk
        options.onStdout?.(cleanChunk)
        return
      }

      streamLineBuffer += cleanChunk
      const lines = streamLineBuffer.split(/\r?\n/u)
      streamLineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        handleStreamLine(line)
      }
    }

    if (!options.suppressObservers) {
      for (const observer of agentRunObservers) {
        void observer.onStart?.(observerContext)
      }
    }

    const proc = spawn(invocation.command, args, {
      cwd,
      env: buildAgentChildEnv(process.env, cwd),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (forceResolveTimer) clearTimeout(forceResolveTimer)
      options.signal?.removeEventListener('abort', onAbort)
      if (options.streamEvents && streamLineBuffer.trim()) {
        handleStreamLine(streamLineBuffer)
        streamLineBuffer = ''
      }
      const durationMs = Date.now() - observerContext.startedAt
      const normalizedText = redactAgentText(
        stripAnsi(streamResultText || textStdout).trim(),
      )
      const timeoutMessage = timedOut
        ? buildTimeoutMessage(options.config.runner.timeoutMs, activity)
        : ''
      const normalizedStderr = redactAgentText(
        stripAnsi([stderr, streamResultError, timeoutMessage].filter(Boolean).join('\n')).trim(),
      )
      let normalizedExitCode = shouldIgnoreShutdownAssertion(
        normalizedText,
        normalizedStderr,
        exitCode ?? 1,
        timedOut,
      )
        ? 0
        : (exitCode ?? 1)
      if (streamResultError && normalizedExitCode === 0) {
        normalizedExitCode = 1
      }
      const inferredFailure = normalizedExitCode === 0
        ? inferFailedToolCompletion(normalizedText, activity)
        : ''
      if (inferredFailure) {
        normalizedExitCode = 1
      }
      const effectiveStderr = [normalizedStderr, inferredFailure].filter(Boolean).join('\n')
      const failure = normalizedExitCode === 0
        ? undefined
        : classifyAgentRunFailure({
            text: normalizedText,
            stderr: effectiveStderr,
            exitCode: normalizedExitCode,
            timedOut,
            activity,
          })
      const result = {
        text: normalizedText,
        stderr: effectiveStderr,
        exitCode: normalizedExitCode,
        timedOut,
        durationMs,
        activity: [...activity],
        ...(failure
          ? {
              failureKind: failure.kind,
              diagnostic: failure.diagnostic,
            }
          : {}),
      }
      if (!options.suppressObservers) {
        for (const observer of agentRunObservers) {
          void observer.onFinish?.(observerContext, result)
        }
      }
      resolve(result)
    }

    const onAbort = () => {
      killProcessTree(proc)
      forceResolveTimer = setTimeout(() => finish(1), 1000)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout.on('data', data => {
      handleStdoutChunk(data.toString())
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('error', error => {
      stderr += error.message
      finish(1)
    })

    proc.on('close', code => finish(code))

    timeoutTimer = setTimeout(() => {
      timedOut = true
      killProcessTree(proc)
      forceResolveTimer = setTimeout(() => finish(1), 1000)
    }, options.config.runner.timeoutMs)

    proc.stdin.end(options.prompt)
  })
}

function parseStreamJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function summarizeStreamJsonProgress(
  message: Record<string, unknown>,
  context?: StreamProgressContext,
): string[] {
  const events: string[] = []
  const type = String(message.type || '')

  if (type === 'system') {
    const subtype = String(message.subtype || '')
    if (subtype === 'init') {
      const tools = Array.isArray(message.tools) ? message.tools.length : 0
      const skills = Array.isArray(message.skills) ? message.skills.length : 0
      const mcpServers = Array.isArray(message.mcp_servers)
        ? message.mcp_servers
            .map(server => {
              if (!server || typeof server !== 'object') return ''
              const record = server as Record<string, unknown>
              return `${String(record.name || 'mcp')}:${String(record.status || 'unknown')}`
            })
            .filter(Boolean)
        : []
      events.push(
        mcpServers.length
          ? `runtime init: ${tools} tools, ${skills} skills, MCP ${mcpServers.join(', ')}`
          : `runtime init: ${tools} tools, ${skills} skills`,
      )
    } else if (subtype === 'api_retry') {
      const retryDelayMs = Number(message.retry_delay_ms || 0)
      const delay = Number.isFinite(retryDelayMs) && retryDelayMs > 0
        ? `, next ${Math.ceil(retryDelayMs / 1000)}s`
        : ''
      const error = message.error ? `, ${String(message.error)}` : ''
      events.push(
        `api retry: attempt ${String(message.attempt || '?')}/${String(message.max_retries || '?')} status ${String(message.error_status ?? 'network')}${delay}${error}`,
      )
    } else if (subtype === 'status' && message.status) {
      events.push(`status: ${String(message.status)}`)
    } else if (subtype === 'task_started') {
      events.push(`task started: ${String(message.description || message.task_id || 'background task')}`)
    } else if (subtype === 'task_progress') {
      const lastTool = message.last_tool_name ? ` via ${String(message.last_tool_name)}` : ''
      events.push(`task progress: ${String(message.description || message.summary || message.task_id || 'background task')}${lastTool}`)
    } else if (subtype === 'task_notification') {
      events.push(`task ${String(message.status || 'updated')}: ${String(message.summary || message.task_id || 'background task')}`)
    } else if (subtype === 'hook_started') {
      events.push(`hook: ${String(message.hook_name || 'hook')} ${String(message.hook_event || '')}`.trim())
    } else if (subtype === 'hook_progress') {
      events.push(`hook progress: ${String(message.hook_name || 'hook')}`)
    } else if (subtype === 'hook_response') {
      events.push(`hook ${String(message.outcome || 'finished')}: ${String(message.hook_name || 'hook')}`)
    } else if (subtype === 'local_command_output') {
      events.push(`local command output: ${summarizeValue(message.content)}`)
    } else if (subtype && subtype !== 'session_state_changed') {
      events.push(`system: ${subtype}`)
    }
  } else if (type === 'assistant') {
    for (const block of getMessageContentBlocks(message)) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      const blockType = String(record.type || '')
      if (blockType === 'thinking' || blockType === 'redacted_thinking') {
        events.push('thinking')
      } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        const event = formatToolUseEvent(record)
        const id = typeof record.id === 'string' ? record.id : ''
        if (id) context?.toolUseById.set(id, event)
        events.push(event)
      } else if (blockType === 'text') {
        events.push('assistant response')
      }
    }
  } else if (type === 'user') {
    for (const block of getMessageContentBlocks(message)) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (record.type === 'tool_result' && record.is_error) {
        const id = typeof record.tool_use_id === 'string' ? record.tool_use_id : ''
        const tool = id ? context?.toolUseById.get(id) : ''
        events.push(
          tool
            ? `tool result error (${tool}): ${summarizeValue(record.content)}`
            : `tool result error: ${summarizeValue(record.content)}`,
        )
      }
    }
  } else if (type === 'tool_progress') {
    events.push(
      `${String(message.tool_name || 'tool')}: running ${String(message.elapsed_time_seconds || 0)}s`,
    )
  } else if (type === 'tool_use_summary') {
    events.push(`tools: ${String(message.summary || 'summary updated')}`)
  } else if (type === 'auth_status') {
    events.push(message.error ? `auth error: ${String(message.error)}` : 'auth status updated')
  } else if (type === 'rate_limit_event') {
    const info = message.rate_limit_info && typeof message.rate_limit_info === 'object'
      ? message.rate_limit_info as Record<string, unknown>
      : {}
    events.push(`rate limit: ${String(info.status || 'updated')}`)
  } else if (type === 'result') {
    events.push(
      message.is_error
        ? `result: ${String(message.subtype || 'error')}`
        : 'result: success',
    )
  }

  return events
    .map(event => redactAgentText(event).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function getMessageContentBlocks(message: Record<string, unknown>): unknown[] {
  const nested = message.message && typeof message.message === 'object'
    ? message.message as Record<string, unknown>
    : undefined
  const content = nested?.content
  return Array.isArray(content) ? content : []
}

function formatToolUseEvent(block: Record<string, unknown>): string {
  const name = String(block.name || 'tool')
  const summary = summarizeToolInput(block.input)
  if (name === 'skill_view' || name === 'Skill') {
    return summary ? `skill: "${summary}"` : 'skill'
  }
  return summary ? `${name}: "${summary}"` : name
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return summarizeValue(input)
  const record = input as Record<string, unknown>
  const preferredKeys = [
    'command',
    'cmd',
    'path',
    'file_path',
    'pattern',
    'glob',
    'query',
    'q',
    'url',
    'name',
    'skill',
    'description',
    'message',
    'prompt',
    'code',
  ]
  for (const key of preferredKeys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return truncateInline(value, 150)
    }
  }
  return truncateInline(safeJsonStringify(input), 150)
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') return truncateInline(value, 150)
  if (Array.isArray(value)) {
    const text = value
      .map(part => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
        if (typeof record.message === 'string') return record.message
        return ''
      })
      .filter(Boolean)
      .join(' ')
    if (text) return truncateInline(text, 150)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['text', 'content', 'message', 'error']) {
      if (typeof record[key] === 'string') {
        return truncateInline(record[key], 150)
      }
    }
  }
  if (value === undefined || value === null) return ''
  return truncateInline(safeJsonStringify(value), 150)
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}

function extractStreamJsonResult(
  message: Record<string, unknown>,
): { text: string; error: string } | null {
  if (message.type !== 'result') return null
  if (message.subtype === 'success') {
    const text = typeof message.result === 'string' ? message.result : ''
    return {
      text,
      error: message.is_error ? text || 'Agent result was marked as an error.' : '',
    }
  }

  const errors = Array.isArray(message.errors)
    ? message.errors.map(String).filter(Boolean).join('\n')
    : ''
  return {
    text: '',
    error: errors || `Agent result error: ${String(message.subtype || 'unknown')}`,
  }
}

function buildTimeoutMessage(timeoutMs: number, activity: string[]): string {
  const lines = [`Agent timed out after ${formatDuration(timeoutMs)}.`]
  const lastActivity = activity.slice(-8)
  if (lastActivity.length > 0) {
    lines.push('Last activity:')
    for (const event of lastActivity) {
      lines.push(`- ${event}`)
    }
  }
  return lines.join('\n')
}

function inferFailedToolCompletion(text: string, activity: string[]): string {
  if (!activity.some(event => /^tool result error\b/i.test(event))) {
    return ''
  }

  const lowerText = text.toLowerCase()
  if (!lowerText.trim()) {
    return 'Agent completed with tool errors but produced no final answer.'
  }

  const failurePhrase =
    /\b(cannot|can't|could not|unable|failed|failure|error|missing|required|invalid|not found|permission denied|timed out)\b|не удалось|не могу|не смог|ошибк|не найден|отсутств|требу|нет доступа|тайм-?аут/iu
  if (!failurePhrase.test(lowerText)) {
    return ''
  }

  return 'Agent completed with an unsuccessful final answer after one or more tool errors.'
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

export function redactAgentText(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bs2_[A-Za-z0-9]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b\d{6,14}:AA[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TELEGRAM_TOKEN]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi, '$1[REDACTED]')
    .replace(/\b(api[_-]?key|token|authorization)\s*[:=]\s*["']?[^"',\s]{8,}/gi, '$1=[REDACTED]')
}

export function classifyAgentRunFailure(input: {
  text: string
  stderr: string
  exitCode: number
  timedOut: boolean
  activity?: string[]
}): { kind: AgentRunFailureKind; diagnostic: string } {
  const combined = [
    input.stderr,
    input.text,
    ...(input.activity || []),
  ].join('\n')
  const lower = combined.toLowerCase()

  let kind: AgentRunFailureKind = 'unknown'
  if (/(429|rate[_ -]?limit|too many requests|quota)/i.test(combined)) {
    kind = 'rate_limit'
  } else if (/(401|unauthori[sz]ed|authentication_failed|invalid api key|bad api key|forbidden|billing_error)/i.test(combined)) {
    kind = 'auth'
  } else if (/(404|model not found|unknown model|does not exist|not_found)/i.test(combined)) {
    kind = 'model_not_found'
  } else if (/(error_max_turns|maximum number of turns|reached max turns)/i.test(combined)) {
    kind = 'max_turns'
  } else if (/(tool result error|tool .*timed out|mcp server .*timed out|mcp.*error)/i.test(combined)) {
    kind = 'tool_error'
  } else if (/(400|invalid_request|bad request|invalid request)/i.test(combined)) {
    kind = 'provider_request'
  } else if (input.timedOut) {
    kind = 'timeout'
  } else if (input.exitCode !== 0) {
    kind = 'execution'
  }

  return {
    kind,
    diagnostic: buildFailureDiagnostic(kind, input, lower),
  }
}

function buildFailureDiagnostic(
  kind: AgentRunFailureKind,
  input: {
    text: string
    stderr: string
    exitCode: number
    timedOut: boolean
    activity?: string[]
  },
  lowerCombined: string,
): string {
  const lines: string[] = []
  lines.push(`Failure kind: ${kind}`)

  if (kind === 'rate_limit') {
    lines.push('Provider rate limit or quota retry detected. Try another model/provider, wait for quota reset, or reduce max turns/tool fanout.')
  } else if (kind === 'auth') {
    lines.push('Provider authentication/billing rejection detected. Check API key, account credits, base URL, and model access.')
  } else if (kind === 'model_not_found') {
    lines.push('Provider did not accept the selected model. Load provider models or set a known model id.')
  } else if (kind === 'provider_request') {
    lines.push('Provider rejected the request shape. Check base URL compatibility and whether the selected model supports the requested tool/message format.')
  } else if (kind === 'max_turns') {
    lines.push('The run reached max turns before finishing. Increase maxTurns or ask the agent to use a narrower execution plan.')
  } else if (kind === 'tool_error') {
    lines.push('A tool/MCP call returned an error. Inspect the last tool activity and tool result text below.')
  } else if (kind === 'timeout') {
    lines.push('The run exceeded the configured timeout. Increase runner timeout or investigate the last tool/model activity.')
  } else {
    lines.push('The agent process exited unsuccessfully. Inspect stderr and recent activity.')
  }

  if (input.timedOut && kind !== 'timeout') {
    lines.push('The run also timed out before the provider/tool issue resolved.')
  }

  if (lowerCombined.includes('mcp-router:connected')) {
    lines.push('MCP router was connected during this run.')
  }

  const lastActivity = input.activity?.slice(-6) || []
  if (lastActivity.length > 0) {
    lines.push('Recent activity:')
    for (const event of lastActivity) {
      lines.push(`- ${event}`)
    }
  }

  return lines.join('\n')
}

function shouldIgnoreShutdownAssertion(
  text: string,
  stderr: string,
  exitCode: number,
  timedOut: boolean,
): boolean {
  if (timedOut || exitCode === 0 || !text) {
    return false
  }

  const stderrLines = stderr
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)

  if (stderrLines.length === 0) {
    return false
  }

  return stderrLines.every(line =>
    IGNORABLE_STDERR_PATTERNS.some(pattern => pattern.test(line)),
  )
}

export function buildPromptFromChatMessages(messages: unknown[]): {
  prompt: string
  systemPrompt?: string
} {
  const systemParts: string[] = []
  const transcript: string[] = []

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const message = raw as Record<string, unknown>
    const role = String(message.role || '').trim()
    const content = normalizeMessageContent(message.content)
    if (!content) continue

    if (role === 'system') {
      systemParts.push(content)
    } else if (role === 'assistant') {
      transcript.push(`Assistant: ${content}`)
    } else if (role === 'user') {
      transcript.push(`User: ${content}`)
    }
  }

  const lastUser = [...transcript].reverse().find(line => line.startsWith('User: '))
  const promptParts = []
  if (systemParts.length) {
    promptParts.push(`System instructions:\n${systemParts.join('\n\n')}`)
  }
  if (transcript.length > 1) {
    promptParts.push(`Conversation so far:\n${transcript.slice(0, -1).join('\n\n')}`)
  }
  promptParts.push(
    lastUser
      ? lastUser.replace(/^User:\s*/, '')
      : transcript.at(-1)?.replace(/^[^:]+:\s*/, '') || '',
  )

  return {
    prompt: promptParts.filter(Boolean).join('\n\n'),
    systemPrompt: systemParts.join('\n\n') || undefined,
  }
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.content === 'string') return record.content
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
