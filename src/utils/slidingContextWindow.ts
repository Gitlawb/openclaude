/**
 * Sliding Context Window - Production Grade
 * 
 * Maintains a rolling window of most relevant tokens.
 * Automatically shifts as conversation progresses.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface SlidingWindowConfig {
  maxTokens: number
  preserveRecent?: number
  preserveTools?: boolean
  preserveErrors?: boolean
  minMessages?: number
}

export interface SlidingWindowState {
  messages: Message[]
  totalTokens: number
  droppedCount: number
  windowStartTime: number
}

const DEFAULT_CONFIG: Required<SlidingWindowConfig> = {
  maxTokens: 50000,
  preserveRecent: 3,
  preserveTools: true,
  preserveErrors: true,
  minMessages: 5,
}

function calculateImportance(message: Message, preserveTools: boolean, preserveErrors: boolean): number {
  let score = 0.3
  const content = message.message?.content

  // Handle structured content blocks
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      
      if (preserveTools && (block.type === 'tool_use' || block.type === 'tool_use_block')) {
        score += 0.4
      }
      
      if (preserveErrors && block.type === 'tool_result' && 'is_error' in block && block.is_error) {
        score += 0.4
      }
    }
  }

  // Fallback to string content check
  const textContent = typeof content === 'string' ? content : ''
  
  if (preserveTools && (textContent.includes('tool_use') || textContent.includes('function_call'))) {
    score += 0.4
  }

  if (preserveErrors && (textContent.includes('error') || textContent.includes('fail'))) {
    score += 0.4
  }

  const ageHours = (Date.now() - (message.message?.created_at ?? 0)) / (1000 * 60 * 60)
  if (ageHours < 0.5) {
    score += 0.2
  } else if (ageHours < 2) {
    score += 0.1
  }

  if (message.message?.role === 'user') {
    score += 0.1
  }

  if (textContent.includes('important') || textContent.includes('critical')) {
    score += 0.15
  }

  return Math.min(1, score)
}

function getMessageTokens(message: Message): number {
  const content = typeof message.message?.content === 'string'
    ? message.message.content
    : typeof message.message?.content === 'object' && message.message?.content !== null
      ? JSON.stringify(message.message.content)
      : ''
  return roughTokenCountEstimation(content)
}

export function createSlidingWindow(
  messages: Message[],
  config: SlidingWindowConfig,
): SlidingWindowState {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Always enforce maxTokens - apply sliding even for small message counts
  // to ensure budget is respected
  const recentMessages = messages.slice(-cfg.preserveRecent)

  const olderMessages = messages.slice(0, -cfg.preserveRecent).map((msg, idx) => ({
    message: msg,
    importance: calculateImportance(msg, cfg.preserveTools, cfg.preserveErrors),
    index: idx,
    tokens: getMessageTokens(msg),
  }))

  olderMessages.sort((a, b) => b.importance - a.importance)

  const selected: Message[] = []
  let totalTokens = recentMessages.reduce((sum, m) => sum + getMessageTokens(m), 0)
  let droppedCount = 0

  for (const item of olderMessages) {
    if (totalTokens + item.tokens <= cfg.maxTokens) {
      selected.push(item.message)
      totalTokens += item.tokens
    } else {
      droppedCount++
    }
  }

  selected.push(...recentMessages)

  selected.sort((a, b) => (a.message?.created_at ?? 0) - (b.message?.created_at ?? 0))

  return {
    messages: selected,
    totalTokens,
    droppedCount,
    windowStartTime: Date.now(),
  }
}

export function slideWindow(
  currentState: SlidingWindowState,
  newMessages: Message[],
  config: SlidingWindowConfig,
): SlidingWindowState {
  const combined = [...currentState.messages, ...newMessages]
  return createSlidingWindow(combined, config)
}

export function getWindowStats(state: SlidingWindowState): {
  totalTokens: number
  messageCount: number
  droppedCount: number
  avgTokensPerMessage: number
  windowAgeMs: number
} {
  return {
    totalTokens: state.totalTokens,
    messageCount: state.messages.length,
    droppedCount: state.droppedCount,
    avgTokensPerMessage: state.messages.length > 0
      ? Math.round(state.totalTokens / state.messages.length)
      : 0,
    windowAgeMs: Date.now() - state.windowStartTime,
  }
}

export function canAddToWindow(
  state: SlidingWindowState,
  message: Message,
  config: SlidingWindowConfig,
): boolean {
  const messageTokens = getMessageTokens(message)
  const cfg = { ...DEFAULT_CONFIG, ...config }
  return state.totalTokens + messageTokens <= cfg.maxTokens
}