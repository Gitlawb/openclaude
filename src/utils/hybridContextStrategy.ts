/**
 * Hybrid Context Strategy - Production Grade
 * 
 * Combines cached + new tokens intelligently.
 * Optimizes for cost vs accuracy.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export interface HybridConfig {
  cacheWeight: number
  freshWeight: number
  maxTotalTokens: number
  costThreshold?: number
}

export interface ContextSplit {
  cached: Message[]
  fresh: Message[]
  cachedTokens: number
  freshTokens: number
  totalTokens: number
}

export interface HybridStrategyResult {
  selectedMessages: Message[]
  totalTokens: number
  strategy: 'cache_heavy' | 'fresh_heavy' | 'balanced'
  estimatedCost: number
}

const DEFAULT_CONFIG: Required<HybridConfig> = {
  cacheWeight: 0.4,
  freshWeight: 0.6,
  maxTotalTokens: 100000,
  costThreshold: 0.01,
}

// Keep enough for: tool_use -> tool_result -> assistant -> user -> next
const MIN_TAILMessages = 5

// Preserve message chains (tool_use + tool_result pairs)
function getMessageChain(
  messages: Message[],
): { chains: Message[][]; orphans: Message[] } {
  const byId = new Map<string, Message[]>()
  const idsWithResult = new Set<string>()

  // Find tool_results and their parent IDs
  for (const msg of messages) {
    const content = msg.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_result' && block?.tool_use_id) {
          idsWithResult.add(block.tool_use_id)
        }
      }
    }
  }

  // Group by ID
  for (const msg of messages) {
    const id = msg.message?.id ?? ''
    if (!id) continue
    const existing = byId.get(id) ?? []
    existing.push(msg)
    byId.set(id, existing)
  }

  const chains: Message[][] = []
  const orphans: Message[] = []

  for (const [id, msgs] of byId) {
    if (idsWithResult.has(id) || msgs.length > 1) {
      chains.push(msgs)
    } else {
      orphans.push(...msgs)
    }
  }

  return { chains, orphans }
}

function getCacheAge(message: Message): number {
  const created = message.message?.created_at ?? 0
  if (created === 0) return 1000
  return (Date.now() - created) / (1000 * 60 * 60)
}

function calculateCacheValue(message: Message): number {
  const content = typeof message.message?.content === 'string' ? message.message.content : ''
  const age = getCacheAge(message)

  let value = 0.5

  if (content.includes('error') || content.includes('fail')) value += 0.3
  if (content.includes('function') || content.includes('class')) value += 0.2
  if (content.includes('important') || content.includes('key')) value += 0.15

  if (age < 1) value += 0.2
  else if (age < 6) value += 0.1
  else value -= 0.2

  if (message.message?.role === 'system') value += 0.1

  return Math.max(0, Math.min(1, value))
}

export function splitContext(
  messages: Message[],
  config: HybridConfig,
): ContextSplit {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const sorted = [...messages].sort((a, b) => {
    const aValue = calculateCacheValue(a)
    const bValue = calculateCacheValue(b)
    return bValue - aValue
  })

  const cached: Message[] = []
  const fresh: Message[] = []
  let cachedTokens = 0
  let freshTokens = 0

  const cacheTarget = Math.floor(cfg.maxTotalTokens * cfg.cacheWeight)
  const freshTarget = Math.floor(cfg.maxTotalTokens * cfg.freshWeight)

  for (const msg of sorted) {
    const tokens = roughTokenCountEstimation(
      typeof msg.message?.content === 'string' ? msg.message.content : ''
    )
    const age = getCacheAge(msg)

    if (age > 24 && cachedTokens < cacheTarget) {
      if (cachedTokens + tokens <= cacheTarget) {
        cached.push(msg)
        cachedTokens += tokens
        continue
      }
    }

    if (freshTokens + tokens <= freshTarget) {
      fresh.push(msg)
      freshTokens += tokens
    }
  }

  return {
    cached,
    fresh,
    cachedTokens,
    freshTokens,
    totalTokens: cachedTokens + freshTokens,
  }
}

export function applyHybridStrategy(
  messages: Message[],
  config: HybridConfig,
): HybridStrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  // Preserve message chains (tool_use/tool_result pairs)
  const { chains, orphans } = getMessageChain(messages)
  
  // Always preserve the conversation tail (last N messages)
  const tailMessages = messages.slice(-MIN_TAILMessages)
  const coreMessages = messages.slice(0, -MIN_TAILMessages)
  
  const split = splitContext(coreMessages, cfg)

  let strategy: HybridStrategyResult['strategy'] = 'balanced'
  if (split.cachedTokens > split.freshTokens * 1.5) {
    strategy = 'cache_heavy'
  } else if (split.freshTokens > split.cachedTokens * 1.5) {
    strategy = 'fresh_heavy'
  }

  // Preserve chains + tail + split result
  const selectedMessages = [
    ...chains.flat(),
    ...split.cached, 
    ...split.fresh, 
    ...tailMessages
  ].sort(
    (a, b) => (a.message?.created_at ?? 0) - (b.message?.created_at ?? 0)
  )

  const totalTokens = roughTokenCountEstimation(
    selectedMessages.map(m => typeof m.message?.content === 'string' ? m.message.content : '').join('\n')
  )

  const estimatedCost = totalTokens * 0.000001 * 0.5

  return {
    selectedMessages,
    totalTokens,
    strategy,
    estimatedCost,
  }
}

export function optimizeForCost(messages: Message[], budget: number): Message[] {
  const result = applyHybridStrategy(messages, {
    cacheWeight: 0.7,
    freshWeight: 0.3,
    maxTotalTokens: Math.floor(budget * 1000),
    costThreshold: budget,
  })
  return result.selectedMessages
}

export function optimizeForAccuracy(messages: Message[], maxTokens: number): Message[] {
  const result = applyHybridStrategy(messages, {
    cacheWeight: 0.3,
    freshWeight: 0.7,
    maxTotalTokens: maxTokens,
  })
  return result.selectedMessages
}

export function getHybridStats(split: ContextSplit) {
  const cacheRatio = split.totalTokens > 0 ? split.cachedTokens / split.totalTokens : 0
  const freshRatio = split.totalTokens > 0 ? split.freshTokens / split.totalTokens : 0

  return {
    cacheRatio: Math.round(cacheRatio * 100),
    freshRatio: Math.round(freshRatio * 100),
    totalTokens: split.totalTokens,
    messageCount: split.cached.length + split.fresh.length,
    efficiency: split.totalTokens / (split.cachedTokens + split.freshTokens + 1),
  }
}