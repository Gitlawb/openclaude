/**
 * nvidia_provider.ts
 * ------------------
 * NVIDIA NVCF provider implementation for OpenClaude.
 * Provides native support for NVIDIA's OpenAI-compatible API.
 *
 * Usage (.env):
 *   CLAUDE_CODE_USE_NVIDIA=1
 *   NVIDIA_API_KEY=nvapi-xxxxx
 *   NVIDIA_MODEL=meta/llama3-70b-instruct
 *   NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
 */

import { logger } from './utils/logger.js'

const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const DEFAULT_NVIDIA_MODEL = 'meta/llama3-70b-instruct'

export interface NvidiaMessage {
  role: string
  content: string | Array<{ type: string; text: string }>
}

export interface NvidiaUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface NvidiaResponse {
  id: string
  model: string
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: NvidiaUsage
}

export interface NvidiaStreamChunk {
  id: string
  model: string
  choices: Array<{
    delta: {
      role?: string
      content?: string
    }
    finish_reason?: string | null
  }>
}

/**
 * Check if NVIDIA API is accessible
 */
export async function checkNvidiaAvailable(): Promise<boolean> {
  try {
    const apiKey = process.env.NVIDIA_API_KEY
    const baseUrl = process.env.NVIDIA_BASE_URL ?? DEFAULT_NVIDIA_BASE_URL
    
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    })
    
    return response.ok
  } catch {
    return false
  }
}

/**
 * List available NVIDIA models
 */
export async function listNvidiaModels(): Promise<string[]> {
  try {
    const apiKey = process.env.NVIDIA_API_KEY
    const baseUrl = process.env.NVIDIA_BASE_URL ?? DEFAULT_NVIDIA_BASE_URL
    
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data = await response.json()
    return (data.data ?? []).map((m: { id: string }) => m.id)
  } catch (error) {
    logger.warning(`Could not list NVIDIA models: ${error}`)
    return []
  }
}

/**
 * Convert Anthropic-format messages to OpenAI format
 */
export function convertMessages(messages: Array<{
  role: string
  content?: unknown
  message?: { role?: string; content?: unknown }
}>): NvidiaMessage[] {
  const result: NvidiaMessage[] = []
  
  for (const msg of messages) {
    const inner = msg.message ?? msg
    const role = inner.role ?? msg.role
    const content = inner.content
    
    if (typeof content === 'string') {
      result.push({ role, content })
    } else if (Array.isArray(content)) {
      const textParts: string[] = []
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text)
        } else if (block.type === 'image') {
          textParts.push('[image]')
        }
      }
      result.push({ role, content: textParts.join('\n') })
    }
  }
  
  return result
}

/**
 * Make a non-streaming chat request to NVIDIA
 */
export async function nvidiaChat(options: {
  model?: string
  messages: Array<{
    role: string
    content?: unknown
    message?: { role?: string; content?: unknown }
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
  const apiKey = process.env.NVIDIA_API_KEY
  const baseUrl = process.env.NVIDIA_BASE_URL ?? DEFAULT_NVIDIA_BASE_URL
  const model = options.model ?? process.env.NVIDIA_MODEL ?? DEFAULT_NVIDIA_MODEL
  
  const openaiMessages = convertMessages(options.messages)
  if (options.system) {
    openaiMessages.unshift({ role: 'system', content: options.system })
  }
  
  const payload = {
    model,
    messages: openaiMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 1.0,
    stream: false,
  }
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`NVIDIA API error (${response.status}): ${errorText}`)
  }
  
  const data: NvidiaResponse = await response.json()
  const choice = data.choices[0]
  
  return {
    id: data.id || 'msg_nvidia',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: choice.message.content }],
    model: data.model || model,
    stopReason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason || 'end_turn',
    stopSequence: null,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  }
}

/**
 * Make a streaming chat request to NVIDIA
 * Yields SSE-format events compatible with Anthropic streaming
 */
export async function* nvidiaChatStream(options: {
  model?: string
  messages: Array<{
    role: string
    content?: unknown
    message?: { role?: string; content?: unknown }
  }>
  system?: string | null
  maxTokens?: number
  temperature?: number
}): AsyncGenerator<{
  type: string
  [key: string]: unknown
}> {
  const apiKey = process.env.NVIDIA_API_KEY
  const baseUrl = process.env.NVIDIA_BASE_URL ?? DEFAULT_NVIDIA_BASE_URL
  const model = options.model ?? process.env.NVIDIA_MODEL ?? DEFAULT_NVIDIA_MODEL
  
  const openaiMessages = convertMessages(options.messages)
  if (options.system) {
    openaiMessages.unshift({ role: 'system', content: options.system })
  }
  
  const payload = {
    model,
    messages: openaiMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 1.0,
    stream: true,
    stream_options: { include_usage: true },
  }
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`NVIDIA API error (${response.status}): ${errorText}`)
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
        id: 'msg_nvidia_stream',
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    }
    
    let hasEmittedContentStart = false
    let contentBlockIndex = 0
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue
        
        let chunk: NvidiaStreamChunk
        try {
          chunk = JSON.parse(trimmed.slice(6))
        } catch {
          continue
        }
        
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta
          
          // Text content
          if (delta.content != null) {
            if (!hasEmittedContentStart) {
              yield {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              }
              hasEmittedContentStart = true
            }
            
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: delta.content },
            }
          }
          
          // Finish reason
          if (choice.finish_reason) {
            if (hasEmittedContentStart) {
              yield {
                type: 'content_block_stop',
                index: contentBlockIndex,
              }
            }
            
            const stopReason = choice.finish_reason === 'stop'
              ? 'end_turn'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn'
            
            yield {
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
            }
            
            // Final usage will come in last chunk
          }
        }
      }
    }
    
    yield { type: 'message_stop' }
  } finally {
    reader.releaseLock()
  }
}
