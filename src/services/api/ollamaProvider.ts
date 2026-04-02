/**
 * ollamaProvider.ts
 * -----------------
 * Native Ollama provider implementation for OpenClaude.
 * Lets Claude Code route requests to any locally-running Ollama model
 * (llama3, mistral, codellama, phi3, qwen2, deepseek-coder, etc.)
 * without needing an API key.
 *
 * Usage (.env):
 *   PREFERRED_PROVIDER=ollama
 *   OLLAMA_BASE_URL=http://localhost:11434
 *   BIG_MODEL=codellama:34b
 *   SMALL_MODEL=llama3:8b
 */

import { logger } from '../utils/logger.js'

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

export interface OllamaMessage {
  role: string
  content: string
}

export interface OllamaModel {
  name: string
  model?: string
  modified_at?: string
  size?: number
  digest?: string
}

export interface OllamaModelsResponse {
  models: OllamaModel[]
}

export interface OllamaChatResponse {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
  prompt_eval_count?: number
  eval_count?: number
}

export interface OllamaStreamChunk {
  model: string
  message: {
    role: string
    content: string
  }
  done: boolean
  prompt_eval_count?: number
  eval_count?: number
}

/**
 * Check if Ollama is running
 */
export async function checkOllamaRunning(): Promise<boolean> {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * List available Ollama models
 */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data: OllamaModelsResponse = await response.json()
    return data.models.map(m => m.name)
  } catch (error) {
    logger.warning(`Could not list Ollama models: ${error}`)
    return []
  }
}

/**
 * Normalize Ollama model name (remove ollama/ prefix if present)
 */
export function normalizeOllamaModel(modelName: string): string {
  if (modelName.startsWith('ollama/')) {
    return modelName.slice('ollama/'.length)
  }
  return modelName
}

/**
 * Convert Anthropic-format messages to Ollama format
 */
export function anthropicToOllamaMessages(messages: Array<{
  role: string
  content?: unknown
}>): OllamaMessage[] {
  const ollamaMessages: OllamaMessage[] = []
  
  for (const msg of messages) {
    const role = msg.role ?? 'user'
    const content = msg.content ?? ''
    
    if (typeof content === 'string') {
      ollamaMessages.push({ role, content })
    } else if (Array.isArray(content)) {
      const textParts: string[] = []
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text)
        } else if (block.type === 'image') {
          textParts.push('[image]')
        }
      }
      ollamaMessages.push({ role, content: textParts.join('\n') })
    }
  }
  
  return ollamaMessages
}

/**
 * Make a non-streaming chat request to Ollama
 */
export async function ollamaChat(options: {
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
  const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
  const model = normalizeOllamaModel(options.model)
  
  const ollamaMessages = anthropicToOllamaMessages(options.messages)
  if (options.system) {
    ollamaMessages.unshift({ role: 'system', content: options.system })
  }
  
  const payload = {
    model,
    messages: ollamaMessages,
    stream: false,
    options: {
      num_predict: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 1.0,
    },
  }
  
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Ollama API error (${response.status}): ${errorText}`)
  }
  
  const data: OllamaChatResponse = await response.json()
  const assistantText = data.message?.content ?? ''
  
  return {
    id: `msg_ollama_${data.created_at ?? 'unknown'}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: assistantText }],
    model,
    stopReason: 'end_turn',
    stopSequence: null,
    usage: {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    },
  }
}

/**
 * Make a streaming chat request to Ollama
 * Yields SSE-format events compatible with Anthropic streaming
 */
export async function* ollamaChatStream(options: {
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
  const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
  const model = normalizeOllamaModel(options.model)
  
  const ollamaMessages = anthropicToOllamaMessages(options.messages)
  if (options.system) {
    ollamaMessages.unshift({ role: 'system', content: options.system })
  }
  
  const payload = {
    model,
    messages: ollamaMessages,
    stream: true,
    options: {
      num_predict: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 1.0,
    },
  }
  
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Ollama API error (${response.status}): ${errorText}`)
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
        id: 'msg_ollama_stream',
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
        if (!line.trim()) continue
        
        let chunk: OllamaStreamChunk
        try {
          chunk = JSON.parse(line)
        } catch {
          continue
        }
        
        const deltaText = chunk.message?.content ?? ''
        
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
        
        if (chunk.done) {
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
              output_tokens: chunk.eval_count ?? 0,
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
