/**
 * Intelligent Summarization - Production Grade
 * 
 * Context-aware message summarization with semantic preservation.
 * Used for token optimization when context window approaches limit.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'

export interface SummarizationConfig {
  targetTokens: number
  preserveRoles?: ('user' | 'assistant' | 'system')[]
  preserveTools?: boolean
  preserveAttachments?: boolean
  minQualityScore?: number
}

export interface SummarizationResult {
  summary: string
  originalTokens: number
  summaryTokens: number
  compressionRatio: number
  preservedMetadata: {
    toolCalls: number
    attachments: number
    messageCount: number
  }
  qualityScore: number
}

export interface MessageSemantic {
  role: 'user' | 'assistant' | 'system'
  content: string
  importance: number
  semanticKey: string
  references: string[]
}

/**
 * Extract semantic keyphrases from content.
 */
function extractSemanticKey(content: string): string {
  const words = content.toLowerCase().split(/\s+/)
  const significant = words.filter(w => w.length > 4 && !STOP_WORDS.has(w))
  return significant.slice(0, 10).sort().join(' ')
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'they', 'will', 'would',
  'this', 'that', 'with', 'from', 'just', 'about', 'also', 'into', 'over',
])

/**
 * Calculate semantic importance of a message.
 */
function calculateImportance(msg: { role: string; content: string }): number {
  let score = 0.5
  
  if (msg.content.includes('error') || msg.content.includes('fail')) {
    score += 0.2
  }
  if (msg.content.includes('important') || msg.content.includes('critical')) {
    score += 0.15
  }
  if (msg.role === 'user') {
    score += 0.1
  }
  if (msg.content.length > 500) {
    score += 0.1
  }
  
  return Math.min(1, score)
}

/**
 * Determine if content contains tool calls.
 */
function hasToolCalls(content: unknown): boolean {
  if (typeof content !== 'string') return false
  return content.includes('tool_use') || content.includes('function_call')
}

/**
 * Intelligently summarize messages while preserving semantic meaning.
 */
export function intelligentSummarize(
  messages: Array<{ role: string; content: unknown; created_at?: number }>,
  config: SummarizationConfig,
): SummarizationResult {
  const targetTokens = config.targetTokens ?? 2000
  const preserveRoles = config.preserveRoles ?? ['user', 'assistant']
  
  const filtered = messages.filter(m => preserveRoles.includes(m.role as 'user' | 'assistant' | 'system'))
  
  const semanticallyImportant = filtered
    .map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return {
        message: m,
        content,
        importance: calculateImportance({ role: m.role, content }),
        semanticKey: extractSemanticKey(content),
      }
    })
    .sort((a, b) => b.importance - a.importance)
  
  let accumulatedTokens = 0
  const selected: typeof semanticallyImportant = []
  
  for (const item of semanticallyImportant) {
    const tokens = roughTokenCountEstimation(item.content)
    if (accumulatedTokens + tokens > targetTokens && selected.length > 3) break
    selected.push(item)
    accumulatedTokens += tokens
  }
  
  const originalTokens = filtered.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + roughTokenCountEstimation(content)
  }, 0)
  
  const summaryContent = selected
    .sort((a, b) => (a.message.created_at ?? 0) - (b.message.created_at ?? 0))
    .map(m => `[${m.message.role}] ${m.content.slice(0, 500)}`)
    .join('\n\n')
  
  const summary = `Summary of ${selected.length} messages:\n\n${summaryContent}`
  const summaryTokens = roughTokenCountEstimation(summary)
  
  const toolCallCount = selected.filter(m => hasToolCalls(m.content)).length
  const qualityScore = Math.min(1, (selected.length / filtered.length) * 0.7 + (1 - summaryTokens / originalTokens) * 0.3)
  
  return {
    summary,
    originalTokens,
    summaryTokens,
    compressionRatio: originalTokens > 0 ? summaryTokens / originalTokens : 1,
    preservedMetadata: {
      toolCalls: toolCallCount,
      attachments: 0,
      messageCount: selected.length,
    },
    qualityScore,
  }
}

/**
 * Create a semantic-preserving compact summary.
 */
export function createCompactSummary(
  messages: Array<{ role: string; content: unknown }>,
  maxTokens: number,
): string {
  const result = intelligentSummarize(messages, { targetTokens: maxTokens })
  return result.summary
}

/**
 * Extract semantic clusters for grouping related messages.
 */
export function extractSemanticClusters(
  messages: Array<{ role: string; content: unknown; created_at?: number }>,
): Map<string, typeof messages> {
  const clusters = new Map<string, typeof messages>()
  
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''
    const key = extractSemanticKey(content).slice(0, 50)
    
    if (!clusters.has(key)) {
      clusters.set(key, [])
    }
    clusters.get(key)!.push(msg)
  }
  
  return clusters
}