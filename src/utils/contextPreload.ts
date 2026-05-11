/**
 * Context Pre-loading - Production Grade
 * 
 * Proactively loads relevant context before it's needed.
 * Prediction based on conversation patterns.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface PreloadConfig {
  maxPreloadTokens: number
  predictionWindow?: number
  confidenceThreshold?: number
}

export interface PreloadPrediction {
  predictedNeed: string[]
  confidence: number
  suggestedMessages: Message[]
}

export interface ConversationPattern {
  userQuery: string
  neededContext: string[]
  frequency: number
}

const PATTERN_KEYWORDS: Record<string, string[]> = {
  'code': ['code', 'function', 'implement', 'write'],
  'debug': ['error', 'bug', 'fix', 'issue', 'debug'],
  'refactor': ['refactor', 'improve', 'clean', 'optimize'],
  'test': ['test', 'spec', 'coverage', 'verify'],
  'explain': ['explain', 'what', 'how', 'why', 'describe'],
  'search': ['find', 'search', 'look', 'grep', 'glob'],
}

export function analyzeConversationPatterns(messages: Message[]): ConversationPattern[] {
  const patterns: ConversationPattern[] = []
  const recentMessages = messages.slice(-10)

  for (let i = 0; i < recentMessages.length - 1; i++) {
    const userMsg = recentMessages[i]
    const assistantMsg = recentMessages[i + 1]

    const userContent = typeof userMsg.message?.content === 'string' ? userMsg.message.content : ''
    const assistantContent = typeof assistantMsg.message?.content === 'string' ? assistantMsg.message.content : ''

    for (const [category, keywords] of Object.entries(PATTERN_KEYWORDS)) {
      if (keywords.some(k => userContent.toLowerCase().includes(k))) {
        patterns.push({
          userQuery: category,
          neededContext: extractContextNeeds(assistantContent),
          frequency: 1,
        })
      }
    }
  }

  return patterns
}

function extractContextNeeds(content: string): string[] {
  const needs: string[] = []
  if (content.includes('file')) needs.push('file_context')
  if (content.includes('function')) needs.push('function_defs')
  if (content.includes('error')) needs.push('error_history')
  if (content.includes('test')) needs.push('test_files')
  return needs
}

export function predictContextNeeds(
  currentQuery: string,
  patterns: ConversationPattern[],
  config: PreloadConfig,
): PreloadPrediction {
  const threshold = config.confidenceThreshold ?? 0.5
  let matchedCategory = ''
  let highestConfidence = 0

  for (const [category, keywords] of Object.entries(PATTERN_KEYWORDS)) {
    const matches = keywords.filter(k => currentQuery.toLowerCase().includes(k)).length
    const confidence = matches / keywords.length

    if (confidence > highestConfidence && confidence >= threshold) {
      highestConfidence = confidence
      matchedCategory = category
    }
  }

  const relevantPatterns = patterns.filter(p => p.userQuery === matchedCategory)
  const allNeeds = relevantPatterns.flatMap(p => p.neededContext)

  return {
    predictedNeed: [...new Set(allNeeds)],
    confidence: highestConfidence,
    suggestedMessages: [],
  }
}

export function preloadContext(
  availableContext: Message[],
  prediction: PreloadPrediction,
  config: PreloadConfig,
): Message[] {
  const targetTokens = config.maxPreloadTokens ?? 30000
  const selected: Message[] = []
  let usedTokens = 0

  const priorityTypes = prediction.predictedNeed

  const sorted = [...availableContext].sort((a, b) => {
    const aContent = typeof a.message?.content === 'string' ? a.message.content : ''
    const bContent = typeof b.message?.content === 'string' ? b.message.content : ''

    const aPriority = priorityTypes.some(t => aContent.includes(t)) ? 1 : 0
    const bPriority = priorityTypes.some(t => bContent.includes(t)) ? 1 : 0

    if (bPriority !== aPriority) return bPriority - aPriority
    return (b.message?.created_at ?? 0) - (a.message?.created_at ?? 0)
  })

  for (const msg of sorted) {
    const tokens = roughTokenCountEstimation(
      typeof msg.message?.content === 'string' ? msg.message.content : ''
    )

    if (usedTokens + tokens > targetTokens) break

    selected.push(msg)
    usedTokens += tokens
  }

  return selected
}

export function createPreloadStrategy(config: PreloadConfig) {
  return {
    analyze: analyzeConversationPatterns,
    predict: (query: string, patterns: ConversationPattern[]) =>
      predictContextNeeds(query, patterns, config),
    preload: (context: Message[], prediction: PreloadPrediction) =>
      preloadContext(context, prediction, config),
  }
}