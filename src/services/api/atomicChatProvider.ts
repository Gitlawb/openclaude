/**
 * atomicChatProvider.ts
 * ---------------------
 * Native Atomic Chat provider implementation for OpenClaude.
 * Lets Claude Code route requests to any locally-running model via
 * Atomic Chat (Apple Silicon only) at 127.0.0.1:1337.
 *
 * Atomic Chat exposes an OpenAI-compatible API, so messages are forwarded
 * directly without translation.
 *
 * Usage (.env):
 *   PREFERRED_PROVIDER=atomic-chat
 *   ATOMIC_CHAT_BASE_URL=http://127.0.0.1:1337
 */

import { logger } from '../utils/logger.js'

const DEFAULT_ATOMIC_CHAT_BASE_URL = 'http://127.0.0.1:1337'

export interface AtomicChatModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

export interface AtomicChatModelsResponse {
  data: AtomicChatModel[]
  object?: string
}

export interface AtomicChatMessage {
  role: string
  content: string | Array<{ type: string; text: string }>
}

export interface AtomicChatResponse {
  id: string
  object?: string
  created?: number
  model: string
  choices: Array<{
    index?: number
    message: {
      role: string
      content: string
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface AtomicChatStreamChunk {
  id: string
  object?: string
  created?: number
  model: string
  choices: Array<{
    index?: number
    delta: {
      role?: string
      content?: string
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function apiBaseUrl(): string {
  return process.env.ATOMIC_CHAT_BASE_URL ?? DEFAULT_ATOMIC_CHAT_BASE_URL
}

function apiUrl(path: string): string {
  return `${apiBaseUrl()}/v1${path}`
}

/**
 * Check if Atomic Chat is running
 */
export async function checkAtomicChatRunning(): Promise<boolean> {
  try {
    const response = await fetch(apiUrl('/models'), {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * List available Atomic Chat models
 */
export async function listAtomicChatModels(): Promise<string[]> {
  try {
    const response = await fetch(apiUrl('/models'), {
      signal: AbortSignal.timeout(5000),
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data: AtomicChatModelsResponse = await response.json()
    return data.data.map(m => m.id)
  } catch (error) {
    logger.warning(`Could not list Atomic Chat models: ${error}`)
    return []
  }
}

/**
 * Make a non-streaming chat request to Atomic Chat
 */
export async function atomicChat(options: {
  model: string
  messages: Array<{
    role: string
    content?: unknown
  }>
  system?: string | null
  maxTokens?: number
  temperature?: number
}): Promise<{
  id: string
  type: string
  role: string
  content: Array<{ type: string; text: string }>
  model: string
  stopReason: string
  stopSequence: null
  usage: {
    inputTokens: number
    outputTokens: number
  }
}> {
  const chatMessages = options.messages.map(msg => ({
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : '',
  }))
  
  if (options.system) {
    chatMessages.unshift({ role: 'system', content: options.system })
  }
  
  const payload = {
    model: options.model,
    messages: chatMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 1.0,
    stream: false,
  }
  
  const response = await fetch(apiUrl('/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Atomic Chat API error (${response.status}): ${errorText}`)
  }
  
  const data: AtomicChatResponse = await response.json()
  const choice = data.choices?.[0]
  const assistantText = choice?.message?.content ?? ''
  const usage = data.usage ?? {}
  
  return {
    id: data.id ?? 'msg_atomic_chat',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: assistantText }],
    model: data.model ?? options.model,
    stopReason: choice?.finish_reason === 'stop' ? 'end_turn' : 'end_turn',
    stopSequence: null,
    usage: {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    },
  }
}

/**
 * Make a streaming chat request to Atomic Chat
 * Yields SSE-format events compatible with Anthropic streaming
 */
export async function* atomicChatStream(options: {
  model: string
  messages: Array<{
    role: string
    content?: unknown
  }>
  system?: string | null
  maxTokens?: number
  temperature?: number
}): AsyncGenerator<{
  type: string
  [key: string]: unknown
}> {
  const chatMessages = options.messages.map(msg => ({
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : '',
  }))
  
  if (options.system) {
    chatMessages.unshift({ role: 'system', content: options.system })
  }
  
  const payload = {
    model: options.model,
    messages: chatMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 1.0,
    stream: true,
  }
  
  const response = await fetch(apiUrl('/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Atomic Chat API error (${response.status}): ${errorText}`)
  }
  
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }
  
  const decoder = new TextDecoder()
  let buffer = ''
  
  try {
    // Emit message_start
    yield {
      type: 'message_start',
      message: {
        id: 'msg_atomic_chat_stream',
        type: 'message',
        role: 'assistant',
        content: [],
        model: options.model,
        stop_reason: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    }
    
    // Emit content_block_start
    yield {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }
    
    let hasEmittedContentStart = false
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        
        const raw = trimmed.slice('data: '.length)
        if (raw.trim() === '[DONE]') {
          break
        }
        
        let chunk: AtomicChatStreamChunk
        try {
          chunk = JSON.parse(raw)
        } catch {
          continue
        }
        
        const delta = chunk.choices?.[0]?.delta ?? {}
        const deltaText = delta.content ?? ''
        
        if (deltaText) {
          if (!hasEmittedContentStart) {
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            }
            hasEmittedContentStart = true
          }
          
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: deltaText },
          }
        }
        
        const finishReason = chunk.choices?.[0]?.finish_reason
        
        if (finishReason || deltaText === '') {
          const usage = chunk.usage ?? {}
          
          yield {
            type: 'content_block_stop',
            index: 0,
          }
          
          yield {
            type: 'message_delta',
            delta: {
              stop_reason: 'end_turn',
              stop_sequence: null,
            },
            usage: {
              output_tokens: usage.completion_tokens ?? 0,
            },
          }
          
          yield {
            type: 'message_stop',
          }
          
          return
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
