import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { deriveShortMessageId } from '../../utils/messages.js'

// Module-level registry of message UUIDs queued for removal. We resolve the
// model-facing short IDs to full UUIDs at mark time (against the snipping
// conversation's own messages) and store the UUIDs. This makes the registry
// self-scoping across concurrent in-process sessions that share this module:
// a UUID only ever matches the conversation it came from, so snipCompactIfNeeded
// consumes ONLY the UUIDs present in its own message array and leaves another
// session's pending removals untouched. (Storing short IDs instead would let one
// session's pending ID collide with — and prune — the wrong message in another.)
// Populated by SnipTool.call(); consumed by snipCompactIfNeeded().
const pendingSnipUuids = new Set<UUID>()

export function markForSnip(shortIds: string[], messages: any[]): void {
  const shortIdToUuid = new Map<string, UUID>()
  for (const msg of messages) {
    if (msg?.uuid) {
      shortIdToUuid.set(deriveShortMessageId(msg.uuid as string), msg.uuid as UUID)
    }
  }
  for (const shortId of shortIds) {
    const uuid = shortIdToUuid.get(shortId)
    if (uuid) pendingSnipUuids.add(uuid)
  }
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
  if (pendingSnipUuids.size === 0) {
    return { messages, tokensFreed: 0 }
  }

  // Match pending UUIDs against THIS conversation's messages. UUIDs that belong
  // to another in-process session won't be present here, so they stay pending.
  const uuidsToRemove = new Set<UUID>()
  for (const msg of messages) {
    const uuid = msg?.uuid as UUID | undefined
    if (uuid && pendingSnipUuids.has(uuid)) uuidsToRemove.add(uuid)
  }

  if (uuidsToRemove.size === 0) {
    return { messages, tokensFreed: 0 }
  }

  // Consume only the matched UUIDs; another session's pending removals survive.
  for (const uuid of uuidsToRemove) pendingSnipUuids.delete(uuid)

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
  // Paired tool-result messages dropped alongside their snipped assistant
  // tool-use message. These are removed from the live context here, so they
  // must also be recorded in the boundary's removedUuids — otherwise replay
  // (projectSnippedView / loadTranscriptFile) only drops the explicitly-marked
  // assistant messages and resurrects orphaned tool results on --resume.
  const removedToolResultUuids = new Set<UUID>()

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
        if (msg?.uuid) removedToolResultUuids.add(msg.uuid as UUID)
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
      // Every UUID removed from the live context: explicitly-snipped messages
      // plus their paired tool-result messages. Replay must drop the same set.
      removedUuids: [...uuidsToRemove, ...removedToolResultUuids] as UUID[],
    },
  }

  return { messages: surviving, tokensFreed, boundaryMessage }
}

export function isSnipMarkerMessage(message: unknown): boolean {
  return (message as any)?.subtype === 'snip_boundary'
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetForTesting(): void {
  pendingSnipUuids.clear()
}
