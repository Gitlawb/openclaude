import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { createReadStream, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// @ts-expect-error - ws types not bundled
import { WebSocketServer, WebSocket } from 'ws'
import { QueryEngine } from '../QueryEngine.js'
import { getTools } from '../tools.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { AppState } from '../state/AppState.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import { setMainLoopModelOverride, switchSession } from '../bootstrap/state.js'
import { resetSessionFilePointer } from '../utils/sessionStorage.js'
import { parseUserSpecifiedModel } from '../utils/model/model.js'
import {
  loadProfileFile,
  saveProfileFile,
  createProfileFile,
  type ProfileFile,
  type ProviderProfile,
  type ProfileEnv,
} from '../utils/providerProfile.js'
import type { SessionInfo } from '../utils/listSessionsImpl.js'
import {
  canonicalizePath,
  getProjectsDir,
  readSessionLite,
  extractFirstPromptFromHead,
  extractLastJsonStringField,
  extractJsonStringField,
} from '../utils/sessionStoragePortable.js'

/**
 * Format tool use input into human-readable display text (matching CLI output style)
 */
function formatToolUseForDisplay(toolName: string, input: any, cwd?: string): string {
  switch (toolName) {
    case 'Edit': {
      const filePath = input.file_path || input.filePath || ''
      const oldStr = input.old_string || input.oldString || ''
      const newStr = input.new_string || input.newString || ''
      // Show full diff like CLI
      const header = `Update(${filePath})`
      // Split and remove only trailing empty string (from trailing newline)
      const oldLines = oldStr.split('\n')
      const newLines = newStr.split('\n')
      if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop()
      if (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop()
      const diffNum = newLines.length - oldLines.length
      const diffStr = diffNum > 0 ? `+${diffNum}` : `${diffNum}`

      // Find line number of old_string in the file
      let startLine = -1
      try {
        const resolvedPath = filePath.startsWith('/') || filePath.match(/^[A-Za-z]:/)
          ? filePath
          : cwd ? join(cwd, filePath) : filePath
        const fileContent = readFileSync(resolvedPath, 'utf-8')
        const fileLines = fileContent.split('\n')
        const firstOldLine = oldLines[0]
        if (firstOldLine !== undefined) {
          for (let i = 0; i < fileLines.length; i++) {
            if (fileLines[i] === firstOldLine) {
              // Verify all old lines match
              let match = true
              for (let j = 0; j < oldLines.length; j++) {
                if (i + j >= fileLines.length || fileLines[i + j] !== oldLines[j]) {
                  match = false
                  break
                }
              }
              if (match) {
                startLine = i + 1 // 1-indexed
                break
              }
            }
          }
        }
      } catch {}

      // Format old and new content with line numbers
      const parts = [`${header} ${diffStr} lines`]
      for (let i = 0; i < oldLines.length; i++) {
        const lineNum = startLine > 0 ? `${startLine + i}` : ''
        parts.push(`- ${lineNum ? lineNum + ': ' : ''}${oldLines[i]}`)
      }
      for (let i = 0; i < newLines.length; i++) {
        const lineNum = startLine > 0 ? `${startLine + i}` : ''
        parts.push(`+ ${lineNum ? lineNum + ': ' : ''}${newLines[i]}`)
      }
      return parts.join('\n')
    }
    case 'Write': {
      const filePath = input.file_path || input.filePath || ''
      const content = input.content || ''
      const lines = content.split('\n').length
      return `Write(${filePath})\n  ${lines} lines`
    }
    case 'Read': {
      const filePath = input.file_path || input.filePath || ''
      const offset = input.offset ? ` from line ${input.offset}` : ''
      const limit = input.limit ? `, ${input.limit} lines` : ''
      return `Read(${filePath}${offset}${limit})`
    }
    case 'Bash': {
      const cmd = input.command || ''
      const truncated = cmd.length > 120 ? cmd.substring(0, 120) + '...' : cmd
      return `Bash: ${truncated}`
    }
    case 'Glob': {
      const pattern = input.pattern || ''
      const path = input.path ? ` in ${input.path}` : ''
      return `Glob(${pattern}${path})`
    }
    case 'Grep': {
      const pattern = input.pattern || ''
      const path = input.path ? ` in ${input.path}` : ''
      return `Grep(${pattern}${path})`
    }
    case 'WebFetch': {
      const url = input.url || ''
      return `WebFetch(${url})`
    }
    case 'WebSearch': {
      const query = input.query || ''
      return `WebSearch(${query})`
    }
    case 'Agent': {
      const desc = input.description || input.prompt?.substring(0, 80) || ''
      return `Agent(${desc})`
    }
    default: {
      // Generic formatting for unknown tools
      const keys = Object.keys(input || {})
      if (keys.length === 0) return toolName
      const summary = keys.map(k => `${k}: ${JSON.stringify(input[k]).substring(0, 50)}`).join(', ')
      return `${toolName}(${summary})`
    }
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

interface SessionData {
  messages: any[]
  createdAt: number
}

export class WebServer {
  private httpServer: ReturnType<typeof createServer>
  private wss: WebSocketServer
  private sessions: Map<string, SessionData> = new Map()
  private webRoot: string
  private port: number
  private host: string

  constructor(options: { port?: number; host?: string; webRoot?: string } = {}) {
    this.port = options.port ?? 3000
    this.host = options.host ?? 'localhost'
    this.webRoot = options.webRoot ?? join(import.meta.dirname, '../../web')

    this.httpServer = createServer(this.handleHttpRequest.bind(this))
    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', this.handleConnection.bind(this))
  }

  private async handleHttpRequest(req: any, res: any) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    console.log('Request:', url.pathname)

    // API endpoints
    if (url.pathname === '/api/projects') {
      return this.handleListProjects(res)
    }
    if (url.pathname === '/api/sessions') {
      const project = url.searchParams.get('project') || undefined
      return this.handleListSessions(res, project)
    }
    if (url.pathname === '/api/session-messages') {
      const project = url.searchParams.get('project') || ''
      const session = url.searchParams.get('session') || ''
      return this.handleGetSessionMessages(res, project, session)
    }

    // Static files
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname
    filePath = join(this.webRoot, filePath)

    try {
      const content = await readFile(filePath)
      const ext = extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' })
      res.end(content)
    } catch (err: any) {
      res.writeHead(404)
      res.end('Not Found')
    }
  }

  private async handleListProjects(res: any) {
    try {
      const projectsDir = getProjectsDir()
      const dirents = await readdir(projectsDir, { withFileTypes: true })

      const projects = await Promise.all(
        dirents
          .filter(d => d.isDirectory())
          .map(async d => {
            const projectPath = join(projectsDir, d.name)
            // Get sessions directly from the project directory
            const sessions = await this.getProjectSessions(projectPath)
            // Get real filesystem path from first session's cwd
            const realPath = sessions[0]?.cwd || this.denormalizeProjectName(d.name)
            return {
              id: d.name,
              name: this.denormalizeProjectName(d.name),
              path: realPath,
              lastModified: sessions[0]?.lastModified || 0,
              sessionCount: sessions.length,
            }
          })
      )

      // Sort by last modified
      projects.sort((a, b) => b.lastModified - a.lastModified)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(projects))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async handleListSessions(res: any, project?: string) {
    try {
      let sessions: SessionInfo[]

      if (project) {
        const projectsDir = getProjectsDir()
        const projectPath = join(projectsDir, project)
        sessions = await this.getProjectSessions(projectPath, 50)
      } else {
        // List sessions from all projects
        const projectsDir = getProjectsDir()
        const dirents = await readdir(projectsDir, { withFileTypes: true })
        const allSessions: SessionInfo[] = []

        for (const d of dirents) {
          if (!d.isDirectory()) continue
          const projectPath = join(projectsDir, d.name)
          const projectSessions = await this.getProjectSessions(projectPath, 10)
          allSessions.push(...projectSessions)
        }

        // Sort by last modified and limit
        allSessions.sort((a, b) => b.lastModified - a.lastModified)
        sessions = allSessions.slice(0, 50)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(sessions))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  /**
   * Read session files directly from a project directory
   */
  private async getProjectSessions(projectPath: string, limit?: number): Promise<SessionInfo[]> {
    try {
      const files = await readdir(projectPath)
      const sessionFiles = files.filter(f => f.endsWith('.jsonl') && !f.includes('subagents'))

      const sessions: SessionInfo[] = []

      for (const file of sessionFiles) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(projectPath, file)

        try {
          const lite = await readSessionLite(filePath)
          if (!lite) continue

          const { head, tail, mtime, size } = lite

          // Skip sidechain sessions
          const firstNewline = head.indexOf('\n')
          const firstLine = firstNewline >= 0 ? head.slice(0, firstNewline) : head
          if (firstLine.includes('"isSidechain":true') || firstLine.includes('"isSidechain": true')) {
            continue
          }

          // Extract metadata
          const customTitle =
            extractLastJsonStringField(tail, 'customTitle') ||
            extractLastJsonStringField(head, 'customTitle') ||
            extractLastJsonStringField(tail, 'aiTitle') ||
            extractLastJsonStringField(head, 'aiTitle') ||
            undefined
          const firstPrompt = extractFirstPromptFromHead(head) || undefined

          const firstTimestamp = extractJsonStringField(head, 'timestamp')
          let createdAt: number | undefined
          if (firstTimestamp) {
            const parsed = Date.parse(firstTimestamp)
            if (!Number.isNaN(parsed)) createdAt = parsed
          }

          const summary =
            customTitle ||
            extractLastJsonStringField(tail, 'lastPrompt') ||
            extractLastJsonStringField(tail, 'summary') ||
            firstPrompt

          // Skip sessions with no summary
          if (!summary) continue

          const gitBranch =
            extractLastJsonStringField(tail, 'gitBranch') ||
            extractJsonStringField(head, 'gitBranch') ||
            undefined
          const cwd = extractJsonStringField(head, 'cwd') || undefined

          sessions.push({
            sessionId,
            summary,
            lastModified: mtime,
            fileSize: size,
            customTitle,
            firstPrompt,
            gitBranch,
            cwd,
            createdAt,
          })
        } catch {
          // Skip unreadable files
          continue
        }
      }

      // Sort by last modified (newest first)
      sessions.sort((a, b) => b.lastModified - a.lastModified)

      return limit ? sessions.slice(0, limit) : sessions
    } catch {
      return []
    }
  }

  private denormalizeProjectName(sanitized: string): string {
    // Convert -Users-foo-my-project back to /Users/foo/my-project
    // The sanitized name uses - for path separators
    const parts = sanitized.split('-').filter(p => p.length > 0)
    // Check if first part is a Windows drive letter (e.g., "C")
    if (parts.length >= 2 && parts[0].length === 1 && /^[A-Z]$/.test(parts[0])) {
      // Windows path: C--items-openclaude -> C:/items/openclaude
      return parts[0] + ':/' + parts.slice(1).join('/')
    }
    // Unix path: Users-foo-my-project -> /Users/foo/my-project
    return '/' + parts.join('/')
  }

  private async handleGetSessionMessages(res: any, project: string, session: string) {
    try {
      if (!project || !session) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing project or session parameter' }))
        return
      }

      const projectsDir = getProjectsDir()
      const projectPath = join(projectsDir, project)
      const filePath = join(projectPath, `${session}.jsonl`)

      // Read and parse JSONL file
      const messages: any[] = []
      let sessionCwd = ''
      const fileStream = createReadStream(filePath, { encoding: 'utf8' })
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity })

      let isFirstLine = true
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line)
          // Extract cwd from first line (session metadata)
          if (isFirstLine) {
            isFirstLine = false
            sessionCwd = entry.cwd || ''
          }
          // Only include user and assistant messages (skip metadata and summaries)
          if (entry.type === 'user' || entry.type === 'assistant') {
            // Skip compact summary messages
            if (entry.isCompactSummary || entry.isMeta) continue

            // Filter out system notification messages
            const rawContent = entry.message?.content
            if (typeof rawContent === 'string' && (rawContent.includes('<task-notification>') || rawContent.includes('<system-reminder>'))) {
              continue
            }
            if (Array.isArray(rawContent)) {
              const hasNotification = rawContent.some((b: any) =>
                b.type === 'text' && (b.text.includes('<task-notification>') || b.text.includes('<system-reminder>'))
              )
              if (hasNotification) continue
            }

            let content = ''
            const toolCalls: any[] = []
            const msgContent = entry.message?.content

            if (typeof msgContent === 'string') {
              content = msgContent
            } else if (Array.isArray(msgContent)) {
              // Extract text from content blocks (skip thinking blocks)
              content = msgContent
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text)
                .join('\n')

              // Extract tool_use blocks for display
              for (const block of msgContent) {
                if (block.type === 'tool_use') {
                  toolCalls.push({
                    toolName: block.name,
                    toolUseId: block.id,
                    display: formatToolUseForDisplay(block.name, block.input, sessionCwd),
                  })
                }
              }
            }

            // Skip messages that look like session continuation summaries
            if (content.startsWith('This session is being continued from')) continue
            if (content.startsWith('Summary:')) continue

            if (content || toolCalls.length > 0) {
              const msg: any = {
                role: entry.type,
                content,
                timestamp: entry.timestamp,
              }
              if (toolCalls.length > 0) {
                msg.toolCalls = toolCalls
              }
              messages.push(msg)
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      // Limit display messages to last 40 for consistency with API context
      const DISPLAY_LIMIT = 40
      const limited = messages.slice(-DISPLAY_LIMIT)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: limited }))
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }

  private async loadSessionMessagesFromFile(filePath: string): Promise<any[]> {
    const messages: any[] = []
    const fileStream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity })

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'user' || entry.type === 'assistant') {
          // Skip compact summary and meta messages
          if (entry.isCompactSummary || entry.isMeta) continue

          // Reconstruct Message object from TranscriptMessage
          // Message type needs: type, uuid, timestamp, message, plus optional fields
          if (entry.message) {
            // Filter out system notification messages (task-notification, system-reminder)
            const msgContent = entry.message.content
            if (typeof msgContent === 'string' && (msgContent.includes('<task-notification>') || msgContent.includes('<system-reminder>'))) {
              continue
            }
            if (Array.isArray(msgContent)) {
              const hasNotification = msgContent.some((b: any) =>
                b.type === 'text' && (b.text.includes('<task-notification>') || b.text.includes('<system-reminder>'))
              )
              if (hasNotification) continue
            }

            const msg: any = {
              type: entry.type,
              uuid: entry.uuid,
              timestamp: entry.timestamp,
              message: entry.message,
            }
            // Preserve optional fields that QueryEngine may use
            if (entry.toolUseResult) msg.toolUseResult = entry.toolUseResult
            if (entry.isMeta) msg.isMeta = entry.isMeta
            if (entry.isCompactSummary) msg.isCompactSummary = entry.isCompactSummary
            messages.push(msg)
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages
  }

  private handleConnection(ws: WebSocket) {
    let engine: QueryEngine | null = null
    let appState: AppState = getDefaultAppState()
    let sessionId = ''
    let previousMessages: any[] = []
    let interrupted = false
    let autoApprove = false
    let cwd = ''
    const approvedTools = new Set<string>()
    const pendingRequests = new Map<string, (reply: any) => void>()

    const send = (data: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    }

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === 'chat') {
          if (engine) {
            send({ type: 'error', message: 'A request is already in progress' })
            return
          }

          interrupted = false
          sessionId = msg.sessionId || randomUUID()
          previousMessages = []

          // Load session history from memory cache
          if (this.sessions.has(sessionId)) {
            previousMessages = [...this.sessions.get(sessionId)!.messages]
          } else if (sessionId) {
            // Try to load from JSONL file
            try {
              const projectsDir = getProjectsDir()
              const dirents = await readdir(projectsDir, { withFileTypes: true })
              for (const d of dirents) {
                if (!d.isDirectory()) continue
                const projectPath = join(projectsDir, d.name)
                const filePath = join(projectPath, `${sessionId}.jsonl`)
                try {
                  await readFile(filePath)
                  const allMessages = await this.loadSessionMessagesFromFile(filePath)
                  // Limit to last 40 messages to avoid exceeding API token limits
                  const MAX_HISTORY = 40
                  previousMessages = allMessages.slice(-MAX_HISTORY)
                  this.sessions.set(sessionId, { messages: previousMessages, createdAt: Date.now() })
                  break
                } catch {
                  // File doesn't exist in this project, continue
                }
              }
            } catch {
              // Failed to load from file, start fresh
            }
          }

          const toolNameById = new Map<string, string>()
          const fileCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)

          cwd = msg.cwd || process.cwd()

          // Resolve model: prefer client-sent model, then profile, then env
          let resolvedModel: string | undefined = msg.model
          if (!resolvedModel) {
            const profile = loadProfileFile({ cwd })
            if (profile?.env?.OPENAI_MODEL) {
              resolvedModel = profile.env.OPENAI_MODEL
            }
          }
          if (!resolvedModel && process.env.OPENAI_MODEL) {
            resolvedModel = process.env.OPENAI_MODEL
          }
          // Set global model override so QueryEngine picks it up
          if (resolvedModel) {
            setMainLoopModelOverride(parseUserSpecifiedModel(resolvedModel))
          }

          const logMsg = `[${new Date().toISOString()}] [web] chat request: ${JSON.stringify({
            clientModel: msg.model,
            resolvedModel,
            baseUrl: process.env.OPENAI_BASE_URL,
            hasApiKey: !!process.env.OPENAI_API_KEY,
            modelEnv: process.env.OPENAI_MODEL,
          })}\n`
          console.log(logMsg.trim())

          // Sync global session ID so sessionStorage writes to the correct file
          // (not the random UUID from process startup)
          switchSession(sessionId as any)
          await resetSessionFilePointer()

          engine = new QueryEngine({
            cwd,
            tools: getTools(appState.toolPermissionContext),
            commands: [],
            mcpClients: [],
            agents: [],
            ...(previousMessages.length > 0 ? { initialMessages: previousMessages } : {}),
            includePartialMessages: true,
            canUseTool: async (tool, input, context, assistantMsg, toolUseID) => {
              if (toolUseID) {
                toolNameById.set(toolUseID, tool.name)
              }

              send({
                type: 'tool_start',
                toolName: tool.name,
                arguments: input,
                toolUseId: toolUseID,
              })

              // Auto-approve mode or already approved tool — skip prompt
              if (autoApprove || approvedTools.has(tool.name)) {
                return { behavior: 'allow' }
              }

              // Ask for permission via UI
              const promptId = randomUUID()
              send({
                type: 'action_required',
                promptId,
                question: `Approve ${tool.name}?`,
                toolName: tool.name,
              })

              return new Promise((resolve) => {
                pendingRequests.set(promptId, (reply) => {
                  const lower = reply.toLowerCase()
                  if (lower === 'yes' || lower === 'y' || lower === 'approve') {
                    approvedTools.add(tool.name)
                    resolve({ behavior: 'allow' })
                  } else {
                    resolve({
                      behavior: 'deny',
                      message: 'User denied',
                      decisionReason: { type: 'other', reason: 'User denied via web UI' },
                    })
                  }
                })
              })
            },
            getAppState: () => appState,
            setAppState: (updater) => { appState = updater(appState) },
            readFileCache: fileCache,
            userSpecifiedModel: resolvedModel,
            fallbackModel: resolvedModel,
          })

          let fullText = ''
          let isThinking = false
          let currentToolUse: { id: string; name: string; inputJson: string } | null = null
          let lastDataTime = Date.now()
          let thinkingTokenEstimate = 0
          const generator = engine.submitMessage(msg.message)

          // Send keepalive while upstream is still processing (no data received)
          const keepaliveTimer = setInterval(() => {
            const idleMs = Date.now() - lastDataTime
            send({ type: 'keepalive', idleMs })
          }, 3000)

          for await (const event of generator) {
            lastDataTime = Date.now()
            if (interrupted) {
              clearInterval(keepaliveTimer)
              break
            }

            if (event.type === 'stream_event') {
              const delta = event.event
              if (delta.type === 'content_block_start') {
                if (delta.content_block?.type === 'thinking') {
                  isThinking = true
                  send({ type: 'thinking_start' })
                } else if (delta.content_block?.type === 'tool_use') {
                  if (isThinking) {
                    isThinking = false
                    send({ type: 'thinking_end' })
                  }
                  currentToolUse = {
                    id: delta.content_block.id,
                    name: delta.content_block.name,
                    inputJson: '',
                  }
                }
              } else if (delta.type === 'content_block_delta') {
                if (delta.delta.type === 'thinking_delta') {
                  thinkingTokenEstimate += delta.delta.thinking.length
                  send({ type: 'thinking_chunk', text: delta.delta.thinking, estimatedTokens: Math.round(thinkingTokenEstimate / 4) })
                } else if (delta.delta.type === 'text_delta') {
                  if (isThinking) {
                    isThinking = false
                    send({ type: 'thinking_end' })
                  }
                  send({ type: 'text_chunk', text: delta.delta.text })
                  fullText += delta.delta.text
                } else if (delta.delta.type === 'input_json_delta' && currentToolUse) {
                  currentToolUse.inputJson += delta.delta.partial_json
                }
              } else if (delta.type === 'content_block_stop') {
                if (isThinking) {
                  isThinking = false
                  send({ type: 'thinking_end' })
                }
                if (currentToolUse) {
                  // Parse accumulated tool input and send formatted display
                  let toolInput: any = {}
                  try { toolInput = JSON.parse(currentToolUse.inputJson) } catch {}
                  const display = formatToolUseForDisplay(currentToolUse.name, toolInput, cwd)
                  send({
                    type: 'tool_use_display',
                    toolName: currentToolUse.name,
                    toolUseId: currentToolUse.id,
                    display,
                  })
                  currentToolUse = null
                }
              }
            } else if (event.type === 'user') {
              const content = event.message.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    let outputStr = ''
                    if (typeof block.content === 'string') {
                      outputStr = block.content
                    } else if (Array.isArray(block.content)) {
                      outputStr = block.content
                        .map((c: any) => (c.type === 'text' ? c.text : ''))
                        .join('\n')
                    }
                    send({
                      type: 'tool_result',
                      toolName: toolNameById.get(block.tool_use_id) ?? block.tool_use_id,
                      toolUseId: block.tool_use_id,
                      output: outputStr,
                      isError: block.is_error || false,
                    })
                  }
                }
              }
            } else if (event.type === 'result') {
              if (event.subtype === 'success') {
                if (event.is_error) {
                  // Don't overwrite fullText with error message — preserve
                  // partial model output accumulated from stream events.
                  // Send error separately so the frontend can display it.
                  console.error('[web] API error (is_error):', event.result)
                  send({ type: 'error', message: event.result || 'Unknown API error' })
                } else if (event.result) {
                  fullText = event.result
                }
              } else if (event.subtype === 'error_during_execution') {
                console.error('[web] error_during_execution:', event.result)
                send({ type: 'error', message: event.result || 'Execution error' })
              } else if (event.subtype === 'error_max_turns') {
                send({ type: 'error', message: event.result || 'Reached max turns' })
              } else if (event.subtype === 'error_max_budget_usd') {
                send({ type: 'error', message: event.result || 'Exceeded USD budget' })
              }
            } else if (event.type === 'system') {
              // System events (e.g. init) — no-op
            } else {
              console.log('[web] unhandled event:', event.type, event.subtype || '')
            }
          }

          if (!interrupted) {
            // Save for multi-turn (cap to avoid unbounded growth)
            const rawMessages = [...engine.getMessages()]
            previousMessages = rawMessages.slice(-60)
            this.sessions.set(sessionId, {
              messages: previousMessages,
              createdAt: Date.now(),
            })

            send({ type: 'done', fullText, sessionId })
          }

          clearInterval(keepaliveTimer)
          engine = null

        } else if (msg.type === 'input') {
          // User replying to a permission prompt
          const promptId = msg.promptId
          const reply = msg.reply
          if (pendingRequests.has(promptId)) {
            pendingRequests.get(promptId)!(reply)
            pendingRequests.delete(promptId)
          }

        } else if (msg.type === 'set_permission_mode') {
          autoApprove = msg.mode === 'auto_approve'
          if (autoApprove) {
            approvedTools.clear()
          }
          send({ type: 'permission_mode_changed', autoApprove })

        } else if (msg.type === 'cancel') {
          interrupted = true
          if (engine) engine.interrupt()
          send({ type: 'cancelled' })

        } else if (msg.type === 'approve') {
          // Direct approval for a tool call
          // This is handled by the pendingRequests map in the chat flow

        } else if (msg.type === 'get_config') {
          // Load current provider profile
          const profile = loadProfileFile({ cwd: process.cwd() })
          send({
            type: 'config',
            profile: profile?.profile || 'openai',
            baseUrl: profile?.env?.OPENAI_BASE_URL || '',
            model: profile?.env?.OPENAI_MODEL || '',
            apiKey: profile?.env?.OPENAI_API_KEY ? '••••••••' : '',
            hasApiKey: !!profile?.env?.OPENAI_API_KEY,
          })

        } else if (msg.type === 'save_config') {
          // Save provider profile
          const profile: ProviderProfile = msg.profile || 'openai'
          const env: ProfileEnv = {
            OPENAI_BASE_URL: msg.baseUrl || undefined,
            OPENAI_MODEL: msg.model || undefined,
          }

          // Only update API key if user provided a new one (not the masked placeholder)
          if (msg.apiKey && msg.apiKey !== '••••••••') {
            env.OPENAI_API_KEY = msg.apiKey
          } else {
            // Keep existing API key
            const existing = loadProfileFile({ cwd: process.cwd() })
            if (existing?.env?.OPENAI_API_KEY) {
              env.OPENAI_API_KEY = existing.env.OPENAI_API_KEY
            }
          }

          // Validate configuration before saving
          send({ type: 'config_validating' })

          try {
            const baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
            const validateUrl = baseUrl.endsWith('/') ? baseUrl + 'models' : baseUrl + '/models'

            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            }
            if (env.OPENAI_API_KEY) {
              headers['Authorization'] = `Bearer ${env.OPENAI_API_KEY}`
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)

            const response = await fetch(validateUrl, {
              method: 'GET',
              headers,
              signal: controller.signal,
            })
            clearTimeout(timeout)

            if (!response.ok) {
              const errorText = await response.text().catch(() => 'Unknown error')
              send({
                type: 'config_error',
                message: `API returned ${response.status}: ${errorText}`,
              })
              return
            }

            // Try to parse response to verify it's valid
            const data = await response.json().catch(() => null)
            if (!data || (!data.data && !Array.isArray(data))) {
              send({
                type: 'config_error',
                message: 'Invalid response from API. Check your Base URL.',
              })
              return
            }

            // Validation passed - save config
            const profileFile = createProfileFile(profile, env)
            saveProfileFile(profileFile, { cwd: process.cwd() })

            // Update environment variables for current process
            if (env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = env.OPENAI_BASE_URL
            if (env.OPENAI_MODEL) process.env.OPENAI_MODEL = env.OPENAI_MODEL
            if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY

            send({ type: 'config_saved', success: true })

          } catch (validateErr: any) {
            const message = validateErr.name === 'AbortError'
              ? 'Connection timeout. Check your Base URL.'
              : `Connection failed: ${validateErr.message}`
            send({
              type: 'config_error',
              message,
            })
          }

        }
      } catch (err: any) {
        console.error('[web] WebSocket handler error:', err.message, err.stack)
        send({ type: 'error', message: err.message || 'Internal error' })
      }
    })

    ws.on('close', () => {
      interrupted = true
      // Unblock any pending permission prompts
      for (const resolve of pendingRequests.values()) {
        resolve({
          behavior: 'deny',
          message: 'Connection closed',
          decisionReason: { type: 'other', reason: 'WebSocket connection closed' },
        })
      }
      pendingRequests.clear()
      if (engine) engine.interrupt()
      engine = null
    })
  }

  start() {
    this.httpServer.listen(this.port, this.host, () => {
      console.log(`OpenClaude Web UI running at http://${this.host}:${this.port}`)
    })
  }
}
