/**
 * Relevance-Based Context Pruning - Production Grade
 * 
 * Prunes context to keep only messages relevant to current task.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface PruningOptions {
  targetTokens: number
  taskContext?: string
  minRelevanceScore?: number
  preserveRecent?: number
  preserveTools?: boolean
  preserveErrors?: boolean
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'they', 'will', 'would',
])

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/)
  const keywords = new Set<string>()

  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, '')
    if (cleaned.length > 3 && !STOP_WORDS.has(cleaned)) {
      keywords.add(cleaned)
    }
  }

  return keywords
}

function calculateKeywordOverlap(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1)
  const keywords2 = extractKeywords(text2)

  let overlap = 0
  for (const keyword of keywords1) {
    if (keywords2.has(keyword)) {
      overlap++
    }
  }

  const total = keywords1.size + keywords2.size
  return total > 0 ? (2 * overlap) / total : 0
}

export function hasToolCalls(message: Message): boolean {
  const content = typeof message.message?.content === 'string'
    ? message.message.content
    : ''

  return content.includes('tool_use') || content.includes('function_call')
}

export function hasErrors(message: Message): boolean {
  const content = typeof message.message?.content === 'string'
    ? message.message.content
    : ''

  return content.includes('error') || content.includes('fail') || content.includes('exception')
}

export function calculateRelevance(
  message: Message,
  options: PruningOptions,
): number {
  const content = typeof message.message?.content === 'string'
    ? message.message.content
    : ''

  let score = 0.5

  const keywordOverlap = options.taskContext
    ? calculateKeywordOverlap(content, options.taskContext)
    : 0

  score += keywordOverlap * 0.3

  if (hasToolCalls(message) && options.preserveTools) {
    score += 0.25
  }

  if (hasErrors(message) && options.preserveErrors) {
    score += 0.3
  }

  const ageHours = (Date.now() - (message.message?.created_at ?? 0)) / (1000 * 60 * 60)
  if (ageHours < 1) {
    score += 0.15
  }

  if (message.message?.role === 'user') {
    score += 0.1
  }

  return Math.min(1, score)
}

export function pruneByRelevance(
  messages: Message[],
  options: PruningOptions,
): Message[] {
  const targetTokens = options.targetTokens ?? 5000
  const minRelevanceScore = options.minRelevanceScore ?? 0.3
  const preserveRecent = options.preserveRecent ?? 3

  let totalTokens = 0
  const recentMessages = messages.slice(-preserveRecent)
  const olderMessages = messages.slice(0, -preserveRecent)

  const scored: Array<{ message: Message; score: number }> = olderMessages.map(msg => ({
    message: msg,
    score: calculateRelevance(msg, options),
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.message.message?.created_at ?? 0) - (a.message.message?.created_at ?? 0)
  })

  const result: Message[] = [...recentMessages]

  for (const { message, score } of scored) {
    if (score < minRelevanceScore) continue

    const content = typeof message.message?.content === 'string'
      ? message.message.content
      : ''

    const tokens = roughTokenCountEstimation(content)

    if (totalTokens + tokens > targetTokens) {
      break
    }

    result.push(message)
    totalTokens += tokens
  }

  return result.sort((a, b) => (a.message?.created_at ?? 0) - (b.message?.created_at ?? 0))
}

export function getTopRelevantMessages(
  messages: Message[],
  options: PruningOptions,
  limit: number = 10,
): Message[] {
  const scored = messages.map(msg => ({
    msg,
    score: calculateRelevance(msg, options),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.msg)
}

export function getRelevanceStats(
  messages: Message[],
  options: PruningOptions,
): {
  averageScore: number
  highRelevanceCount: number
  toolCallCount: number
  errorCount: number
} {
  const scores = messages.map(msg => calculateRelevance(msg, options))

  const averageScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : 0

  return {
    averageScore,
    highRelevanceCount: scores.filter(s => s > 0.7).length,
    toolCallCount: messages.filter(hasToolCalls).length,
    errorCount: messages.filter(hasErrors).length,
  }
}