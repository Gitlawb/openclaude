/**
 * Importance-Weighted Context - Production Grade
 * 
 * Assigns importance scores to messages for selective retention.
 * Uses tool use frequency, user attention, and content analysis.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface ImportanceScore {
  message: Message
  score: number
  factors: {
    recency: number
    toolUse: number
    errors: number
    userFocus: number
    content: number
  }
}

export interface WeightedContextOptions {
  maxTokens: number
  minScore?: number
  preserveRecent?: number
  decayFactor?: number
}

const DEFAULT_OPTIONS: Required<WeightedContextOptions> = {
  maxTokens: 50000,
  minScore: 0.3,
  preserveRecent: 3,
  decayFactor: 0.95,
}

function getContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c
      if (typeof c === 'object' && c !== null) {
        // Keep structured blocks for importance scoring
        if ('text' in c) return (c as any).text ?? ''
        if ('thinking' in c) return (c as any).thinking ?? ''
        // Include tool_use, tool_result in content
        if ('type' in c) return `[${(c as any).type}]`
      }
      return ''
    }).join(' ')
  }
  return ''
}

export function calculateImportanceScores(
  messages: Message[],
  options: WeightedContextOptions,
): ImportanceScore[] {
  const cfg = { ...DEFAULT_OPTIONS, ...options }
  const now = Date.now()

  return messages.map((message, index) => {
    const content = getContent(message.message?.content)
    const createdAt = message.message?.created_at ?? 0

    const recencyHours = (now - createdAt) / (1000 * 60 * 60)
    const recency = recencyHours < 0.5 ? 1 : recencyHours < 2 ? 0.8 : recencyHours < 6 ? 0.6 : Math.max(0.1, 1 - recencyHours / 24)

    const toolUse = content.includes('tool_use') || content.includes('function_call')
      ? 0.9
      : 0

    const errorContent = content.includes('error') || content.includes('fail') || content.includes('exception')
      ? 0.85
      : 0

    const userFocus = message.message?.role === 'user' ? 0.7 : 0

    const contentLength = content.length
    const contentScore = contentLength > 1000 ? 0.8 : contentLength > 500 ? 0.6 : 0.4

    const combinedScore = (recency * 0.25) +
      (toolUse * 0.3) +
      (errorContent * 0.25) +
      (userFocus * 0.1) +
      (contentScore * 0.1)

    return {
      message,
      score: Math.min(1, combinedScore),
      factors: {
        recency,
        toolUse,
        errors: errorContent,
        userFocus,
        content: contentScore,
      },
    }
  })
}

export function selectWeightedMessages(
  messages: Message[],
  options: WeightedContextOptions,
): Message[] {
  const cfg = { ...DEFAULT_OPTIONS, ...options }

  const scores = calculateImportanceScores(messages, options)
  const recent = messages.slice(-cfg.preserveRecent)
  
  // Check if recent alone exceeds budget
  const recentTokens = recent.reduce((sum, m) => 
    sum + roughTokenCountEstimation(getContent(m.message?.content)), 0)
  
  if (recentTokens > cfg.maxTokens) {
    // Return truncated recent within budget
    const truncated: Message[] = []
    let used = 0
    for (const msg of recent) {
      const tok = roughTokenCountEstimation(getContent(msg.message?.content))
      if (used + tok <= cfg.maxTokens) {
        truncated.push(msg)
        used += tok
      }
    }
    return truncated
  }

  scores.sort((a, b) => b.score - a.score)

  const selected: Message[] = []
  let totalTokens = recentTokens  // Start with recent tokens

  for (const { message } of scores) {
    const content = getContent(message.message?.content)
    const tokens = roughTokenCountEstimation(content)

    if (totalTokens + tokens > cfg.maxTokens) {
      continue
    }

    selected.push(message)
    totalTokens += tokens
  }

  const combined = [...selected, ...recent]
  const seen = new Set<string>()
  const deduped: Message[] = []

  for (const msg of combined) {
    const key = `${msg.message?.role}-${msg.message?.created_at}-${getContent(msg.message?.content).slice(0, 50)}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(msg)
    }
  }

  return deduped.sort((a, b) => (a.message?.created_at ?? 0) - (b.message?.created_at ?? 0))
}

export function getWeightedStats(
  messages: Message[],
  options: WeightedContextOptions,
): {
  averageScore: number
  highPriorityCount: number
  toolCallCount: number
  errorCount: number
  totalTokens: number
} {
  const scores = calculateImportanceScores(messages, options)

  const averageScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
    : 0

  const contentList = messages.map(m => getContent(m.message?.content))

  return {
    averageScore,
    highPriorityCount: scores.filter(s => s.score > 0.7).length,
    toolCallCount: contentList.filter(c => c.includes('tool_use')).length,
    errorCount: contentList.filter(c => c.includes('error') || c.includes('fail')).length,
    totalTokens: messages.reduce((sum, m) => sum + roughTokenCountEstimation(getContent(m.message?.content)), 0),
  }
}

export function getTopMessagesByWeight(
  messages: Message[],
  options: WeightedContextOptions,
  limit: number = 10,
): Message[] {
  const scores = calculateImportanceScores(messages, options)
  scores.sort((a, b) => b.score - a.score)
  return scores.slice(0, limit).map(s => s.message)
}