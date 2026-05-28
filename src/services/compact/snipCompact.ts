import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { deriveShortMessageId } from '../../utils/messages.js'

// Module-level registry of short message IDs queued for removal.
// Populated by SnipTool.call(); consumed and cleared by snipCompactIfNeeded().
const pendingSnipIds = new Set<string>()

export function markForSnip(ids: string[]): void {
  for (const id of ids) pendingSnipIds.add(id)
}

export function isSnipRuntimeEnabled(): boolean {
  return true
}

export const SNIP_NUDGE_TEXT =
  `Your context window is filling up. Use the \`snip\` tool to remove messages ` +
  `that are no longer needed — look for \`[id:...]\` tags on user messages and pass the IDs ` +
  `of stale sections (old explorations, superseded plans, resolved errors). This frees up ` +
  `space so you can continue working without a full compaction.`

// Nudge once every ~10 000 tokens of new content since the last reset point.
const NUDGE_INTERVAL_TOKENS = 10_000

/**
 * Rough per-message token estimate: content length ÷ 4.
 */
function estimateTokens(msg: any): number {
  const content = msg?.message?.content ?? msg?.content ?? ''
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return Math.ceil(text.length / 4)
}

export function shouldNudgeForSnips(messages: any[]): boolean {
  let accumulated = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type === 'system' && msg?.subtype === 'compact_boundary') return false
    if (msg?.snipMetadata) return false
    if (
      msg?.type === 'attachment' &&
      msg?.attachment?.type === 'context_efficiency'
    ) return false
    accumulated += estimateTokens(msg)
    if (accumulated >= NUDGE_INTERVAL_TOKENS) return true
  }
  return false
}

export function snipCompactIfNeeded(
  messages: any[],
): { messages: any[]; tokensFreed: number; boundaryMessage?: any } {
  if (pendingSnipIds.size === 0) {
    return { messages, tokensFreed: 0 }
  }

  // Map short ID → UUID for messages present in the current array
  const shortIdToUuid = new Map<string, UUID>()
  for (const msg of messages) {
    if (msg?.uuid) {
      shortIdToUuid.set(deriveShortMessageId(msg.uuid as string), msg.uuid as UUID)
    }
  }

  // Resolve pending short IDs to full UUIDs
  const uuidsToRemove = new Set<UUID>()
  for (const shortId of pendingSnipIds) {
    const uuid = shortIdToUuid.get(shortId)
    if (uuid) uuidsToRemove.add(uuid)
  }
  pendingSnipIds.clear()

  if (uuidsToRemove.size === 0) {
    return { messages, tokensFreed: 0 }
  }

  // Collect tool_use IDs from snipped assistant messages so we can also
  // drop the paired tool-result user messages.
  const snippedToolUseIds = new Set<string>()
  for (const msg of messages) {
    if (!uuidsToRemove.has(msg?.uuid)) continue
    if (msg?.type !== 'assistant') continue
    const blocks = msg?.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block?.type === 'tool_use' && block?.id) snippedToolUseIds.add(block.id as string)
    }
  }

  let tokensFreed = 0
  const surviving: any[] = []

  for (const msg of messages) {
    // Drop snipped messages
    if (uuidsToRemove.has(msg?.uuid)) {
      tokensFreed += estimateTokens(msg)
      continue
    }
    // Drop user messages whose content is entirely tool results for snipped tool calls
    if (msg?.type === 'user' && Array.isArray(msg?.message?.content)) {
      const results = (msg.message.content as any[]).filter(b => b?.type === 'tool_result')
      if (
        results.length > 0 &&
        results.every((r: any) => snippedToolUseIds.has(r?.tool_use_id))
      ) {
        tokensFreed += estimateTokens(msg)
        continue
      }
    }
    surviving.push(msg)
  }

  const boundaryMessage = {
    type: 'system' as const,
    subtype: 'snip_boundary',
    content: 'Conversation history snipped',
    isMeta: false as const,
    timestamp: new Date().toISOString(),
    uuid: randomUUID() as UUID,
    level: 'info' as const,
    snipMetadata: {
      removedUuids: [...uuidsToRemove] as UUID[],
    },
  }

  return { messages: surviving, tokensFreed, boundaryMessage }
}

export function isSnipMarkerMessage(message: unknown): boolean {
  return (message as any)?.subtype === 'snip_boundary'
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetForTesting(): void {
  pendingSnipIds.clear()
}
