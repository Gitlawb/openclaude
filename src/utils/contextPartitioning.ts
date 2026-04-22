/**
 * Context Window Partitioning - Production Grade
 * 
 * Splits context into priority zones with different retention policies.
 * Used for intelligent context management when context window is tight.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'

export type PriorityZone = 'recent' | 'important' | 'background' | 'system'

export interface ZoneConfig {
  name: PriorityZone
  maxTokens: number
  retentionPolicy: 'keep_all' | 'prune_oldest' | 'prune_least_important'
  priority: number
}

export interface PartitionedContext {
  zones: Map<PriorityZone, Message[]>
  totalTokens: number
  zoneTokens: Map<PriorityZone, number>
  canFitInWindow: boolean
}

export interface PartitionOptions {
  contextWindow: number
  zones?: ZoneConfig[]
  recentCount?: number
  systemPromptTokens?: number
}

const DEFAULT_ZONES: ZoneConfig[] = [
  { name: 'recent', maxTokens: 50000, retentionPolicy: 'keep_all', priority: 4 },
  { name: 'important', maxTokens: 30000, retentionPolicy: 'prune_least_important', priority: 3 },
  { name: 'background', maxTokens: 10000, retentionPolicy: 'prune_oldest', priority: 2 },
  { name: 'system', maxTokens: 8000, retentionPolicy: 'keep_all', priority: 1 },
]

function classifyMessage(message: Message): PriorityZone {
  const content = typeof message.message?.content === 'string'
    ? message.message.content
    : ''

  if (message.message?.role === 'system') {
    return 'system'
  }

  if (content.includes('error') || content.includes('fail') || content.includes('important')) {
    return 'important'
  }

  if (content.length > 2000 || content.includes('tool_use')) {
    return 'important'
  }

  return 'background'
}

export function partitionContext(
  messages: Message[],
  options: PartitionOptions,
): PartitionedContext {
  const zones = new Map<PriorityZone, Message[]>()
  const zoneTokens = new Map<PriorityZone, number>()
  const zonesConfig = options.zones ?? DEFAULT_ZONES

  for (const zone of zonesConfig) {
    zones.set(zone.name, [])
    zoneTokens.set(zone.name, 0)
  }

  const recentCount = options.recentCount ?? 5
  const recentMessages = messages.slice(-recentCount)
  const olderMessages = messages.slice(0, -recentCount)

  for (const msg of recentMessages) {
    const zone = classifyMessage(msg)
    zones.get(zone)!.push(msg)
    zoneTokens.set(zone, zoneTokens.get(zone)! + roughTokenCountEstimation(
      typeof msg.message?.content === 'string' ? msg.message.content : ''
    ))
  }

  for (const msg of olderMessages) {
    const zone = classifyMessage(msg)
    const currentZone = zones.get(zone)!

    if (zone === 'important' && zoneTokens.get('important')! < 30000) {
      currentZone.push(msg)
      zoneTokens.set('important', zoneTokens.get('important')! + roughTokenCountEstimation(
        typeof msg.message?.content === 'string' ? msg.message.content : ''
      ))
    } else if (zone === 'background' && zoneTokens.get('background')! < 10000) {
      currentZone.push(msg)
      zoneTokens.set('background', zoneTokens.get('background')! + roughTokenCountEstimation(
        typeof msg.message?.content === 'string' ? msg.message.content : ''
      ))
    }
  }

  const totalTokens = Array.from(zoneTokens.values()).reduce((a, b) => a + b, 0)
  const canFitInWindow = totalTokens <= options.contextWindow

  return { zones, totalTokens, zoneTokens, canFitInWindow }
}

export function getZoneMessages(
  context: PartitionedContext,
  zone: PriorityZone,
): Message[] {
  return context.zones.get(zone) ?? []
}

export function getAllMessages(context: PartitionedContext): Message[] {
  const messages: Message[] = []
  for (const [zoneName, zoneMessages] of context.zones) {
    if (zoneName === 'system') continue
    messages.push(...zoneMessages)
  }
  return messages.sort((a, b) => (a.message?.created_at ?? 0) - (b.message?.created_at ?? 0))
}

export function getAvailableSpace(context: PartitionedContext): number {
  const reserved = (context.zoneTokens.get('important') ?? 0) + (context.zoneTokens.get('system') ?? 0)
  return Math.max(0, reserved - context.totalTokens)
}