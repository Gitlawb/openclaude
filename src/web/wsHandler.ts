import { randomUUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { WebSocket } from 'ws'
import { QueryEngine } from '../QueryEngine.js'
import { getTools } from '../tools.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import type { AppState } from '../state/AppState.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import { getAgentDefinitionsWithOverrides, type AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { recordTranscript, flushSessionStorage } from '../utils/sessionStorage.js'
import { detectProvider } from './provider.js'
import type { SessionStore } from './sessionStore.js'

interface ImageAttachment {
  data: string
  mediaType: string
}

interface ClientRequest {
  type: 'request'
  message: string
  sessionId?: string
  cwd?: string
  model?: string
  images?: ImageAttachment[]
}

interface ClientInput {
  type: 'input'
  promptId: string
  reply: string
}

interface ClientCancel {
  type: 'cancel'
}

type ClientMessage = ClientRequest | ClientInput | ClientCancel

function isValidClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as Record<string, unknown>
  if (msg.type === 'request') return typeof msg.message === 'string'
  if (msg.type === 'input') return typeof msg.promptId === 'string' && typeof msg.reply === 'string'
  if (msg.type === 'cancel') return true
  return false
}

interface ContentBlock {
  type: string
  text?: string
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as ContentBlock[])
    .map((block) => {
      if (block.type === 'text') return block.text ?? ''
      return ''
    })
    .filter(Boolean)
    .join('')
}

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30

export function handleWebSocketConnection(ws: WebSocket, sessions: SessionStore) {
  let engine: QueryEngine | null = null
  let appState: AppState = getDefaultAppState()
  const fileCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)
  const pendingRequests = new Map<string, (reply: string) => void>()
  const sessionAllowedTools = new Set<string>()
  let previousMessages: unknown[] = []
  let sessionId = ''
  let interrupted = false
  let activeCwd = process.cwd()

  const rateLimitWindow: number[] = []

  function isRateLimited(): boolean {
    const now = Date.now()
    while (rateLimitWindow.length > 0 && now - rateLimitWindow[0] > RATE_LIMIT_WINDOW_MS) {
      rateLimitWindow.shift()
    }
    if (rateLimitWindow.length >= RATE_LIMIT_MAX_REQUESTS) return true
    rateLimitWindow.push(now)
    return false
  }

  const send = (data: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  const providerInfo = detectProvider()
  send({ type: 'config', cwd: activeCwd, ...providerInfo, noProvider: providerInfo.provider === 'unknown' })

  ws.on('message', async (raw: any) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(raw))
    } catch {
      send({ type: 'error', message: 'Invalid JSON', code: 'INVALID_JSON' })
      return
    }

    if (!isValidClientMessage(parsed)) {
      send({ type: 'error', message: 'Invalid message format', code: 'INVALID_FORMAT' })
      return
    }

    if (parsed.type === 'request' && isRateLimited()) {
      send({ type: 'error', message: 'Rate limit exceeded — try again shortly', code: 'RATE_LIMITED' })
      return
    }

    try {
      if (parsed.type === 'request') {
        if (engine) {
          send({ type: 'error', message: 'A request is already in progress', code: 'ALREADY_EXISTS' })
          return
        }

        interrupted = false
        sessionId = parsed.sessionId || ''

        if (parsed.cwd) {
          activeCwd = parsed.cwd
        }

        previousMessages = []
        if (sessionId) {
          const stored = sessions.get(sessionId)
          if (stored) previousMessages = [...stored]
        }

        const toolNameById = new Map<string, string>()

        let agentDefs: AgentDefinition[] = []
        try {
          const result = await getAgentDefinitionsWithOverrides(activeCwd)
          agentDefs = result.activeAgents
        } catch {
          // Fall back to empty agents if loading fails
        }

        engine = new QueryEngine({
          cwd: activeCwd,
          tools: getTools(appState.toolPermissionContext),
          commands: [],
          mcpClients: [],
          agents: agentDefs,
          ...(previousMessages.length > 0 ? { initialMessages: previousMessages } : {}),
          ...(parsed.model ? { userSpecifiedModel: parsed.model } : {}),
          includePartialMessages: true,
          canUseTool: async (tool, input, _context, _assistantMsg, toolUseID) => {
            if (toolUseID) {
              toolNameById.set(toolUseID, tool.name)
            }

            send({
              type: 'tool_start',
              toolName: tool.name,
              args: JSON.stringify(input),
              toolUseId: toolUseID,
            })

            if (sessionAllowedTools.has(tool.name)) {
              return { behavior: 'allow' }
            }

            const promptId = randomUUID()
            send({
              type: 'action_required',
              promptId,
              question: `Allow ${tool.name}?`,
              toolName: tool.name,
              actionType: 'CONFIRM_COMMAND',
            })

            return new Promise((resolve) => {
              pendingRequests.set(promptId, (reply) => {
                const lower = reply.toLowerCase()
                if (lower === 'session') {
                  sessionAllowedTools.add(tool.name)
                  resolve({ behavior: 'allow' })
                } else if (lower === 'yes' || lower === 'y') {
                  resolve({ behavior: 'allow' })
                } else {
                  resolve({
                    behavior: 'deny',
                    message: 'User denied via web UI',
                    decisionReason: { type: 'other', reason: 'User denied via web UI' },
                  })
                }
              })
            })
          },
          getAppState: () => appState,
          setAppState: (updater) => {
            appState = updater(appState)
          },
          readFileCache: fileCache,
        })

        let fullText = ''
        let promptTokens = 0
        let completionTokens = 0
        let actualModel = parsed.model || ''

        let messageInput: string | ContentBlockParam[] = parsed.message
        if (parsed.images && parsed.images.length > 0) {
          const contentBlocks: ContentBlockParam[] = [{ type: 'text', text: parsed.message }]
          for (const img of parsed.images) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: (img.mediaType || 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: img.data,
              },
            })
          }
          messageInput = contentBlocks
        }

        const generator = engine.submitMessage(messageInput)

        for await (const msg of generator) {
          if (interrupted) break

          if (msg.type === 'stream_event') {
            if (msg.event.type === 'message_start' && msg.event.message?.model) {
              actualModel = msg.event.message.model
            }
            if (msg.event.type === 'content_block_delta' && msg.event.delta.type === 'text_delta') {
              send({ type: 'text_chunk', text: msg.event.delta.text })
              fullText += msg.event.delta.text
            }
          } else if (msg.type === 'assistant') {
            if (msg.message?.model) actualModel = msg.message.model
            const text = extractTextFromContent(msg.message?.content)
            if (text) {
              send({ type: 'text_chunk', text })
              fullText += text
            }
          } else if (msg.type === 'user') {
            const content = msg.message.content
            if (Array.isArray(content)) {
              for (const block of content as Record<string, unknown>[]) {
                if (block.type === 'tool_result') {
                  let outputStr = ''
                  if (typeof block.content === 'string') {
                    outputStr = block.content
                  } else if (Array.isArray(block.content)) {
                    outputStr = (block.content as ContentBlock[])
                      .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
                      .join('\n')
                  }
                  send({
                    type: 'tool_result',
                    toolName: toolNameById.get(block.tool_use_id as string) ?? block.tool_use_id,
                    toolUseId: block.tool_use_id,
                    output: outputStr,
                    isError: block.is_error || false,
                  })
                }
              }
            }
          } else if (msg.type === 'result') {
            if (msg.subtype === 'success') {
              if (msg.result && !fullText) {
                fullText = msg.result
                send({ type: 'text_chunk', text: fullText })
              }
              promptTokens = msg.usage?.input_tokens ?? 0
              completionTokens = msg.usage?.output_tokens ?? 0
            } else {
              const errMsg = msg.subtype?.replace('error_', '').replace(/_/g, ' ') || 'unknown error'
              send({ type: 'error', message: errMsg, code: msg.subtype || 'ERROR' })
            }
          }
        }

        if (!interrupted) {
          previousMessages = [...engine.getMessages()]

          if (sessionId) {
            sessions.set(sessionId, previousMessages)
          }

          try {
            await recordTranscript(previousMessages)
          } catch {
            // Non-fatal: session still works even if persistence fails
          }

          send({
            type: 'done',
            fullText,
            promptTokens,
            completionTokens,
            model: actualModel || parsed.model || detectProvider().model,
          })
        }

        engine = null
      } else if (parsed.type === 'input') {
        const resolver = pendingRequests.get(parsed.promptId)
        if (resolver) {
          resolver(parsed.reply)
          pendingRequests.delete(parsed.promptId)
        }
      } else if (parsed.type === 'cancel') {
        interrupted = true
        if (engine) {
          engine.interrupt()
        }
      }
    } catch (err: unknown) {
      console.error('Error processing WebSocket message:', err)
      const message = err instanceof Error ? err.message : String(err)
      send({
        type: 'error',
        message: message || 'Internal server error',
        code: 'INTERNAL',
      })
      engine = null
    }
  })

  ws.on('close', async () => {
    interrupted = true
    for (const resolve of pendingRequests.values()) {
      resolve('no')
    }
    if (engine) {
      engine.interrupt()
    }
    engine = null
    pendingRequests.clear()

    try {
      await flushSessionStorage()
    } catch {
      // Best-effort flush on disconnect
    }
  })
}
