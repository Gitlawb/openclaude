/**
 * Bounded retention for the in-process teammate `allMessages` buffer.
 *
 * The in-process teammate runner (inProcessRunner.ts) accumulates every
 * user/assistant message it ever sees into a local `allMessages` array so the
 * full conversation can be replayed as context on each iteration. Token-based
 * auto-compaction (getAutoCompactThreshold) is the primary bound, but it is an
 * expensive async LLM round-trip that only fires at the token threshold. In
 * long-lived teammate sessions the array can still grow large between
 * compactions and is a documented contributor to JS-heap OOM (#1379, and the
 * BQ analysis cited on TEAMMATE_MESSAGES_UI_CAP showing ~20MB RSS per agent at
 * 500+ turns). This module adds a cheap, synchronous hard cap as a safety net
 * that runs every iteration regardless of token count.
 *
 * Unlike the UI mirror cap (TEAMMATE_MESSAGES_UI_CAP, a naive slice on
 * task.messages which is display-only), this buffer is the actual LLM context,
 * so the window must preserve tool_use <-> tool_result pairing: the API rejects
 * a tool_result whose originating tool_use is missing. We keep the most recent
 * messages (the relevant context) and, after slicing, strip any leading
 * tool_result blocks orphaned by the cut so no retained tool_result dangles.
 */

import type { Message } from '../../types/message.js'

/**
 * Hard cap on the number of messages retained in the teammate `allMessages`
 * buffer. Far larger than TEAMMATE_MESSAGES_UI_CAP (50, display-only) because
 * this buffer carries the conversation context the agent actually needs;
 * token-based auto-compaction handles normal-sized histories well before this.
 * This is purely a heap safety net for pathological long sessions where many
 * small messages accumulate without crossing the token threshold.
 */
export const TEAMMATE_CONTEXT_MESSAGES_CAP = 1000

type ContentBlock = { type?: string; tool_use_id?: string; id?: string }

function getBlocks(message: Message): ContentBlock[] {
  const content = (message as { message?: { content?: unknown } }).message
    ?.content
  return Array.isArray(content) ? (content as ContentBlock[]) : []
}

/** Collect the set of tool_use ids that appear in the given messages. */
function collectToolUseIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const block of getBlocks(message)) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        ids.add(block.id)
      }
    }
  }
  return ids
}

/**
 * Cap `messages` to the most recent TEAMMATE_CONTEXT_MESSAGES_CAP entries while
 * preserving tool_use <-> tool_result pairing.
 *
 * Returns the input unchanged (same reference) when already within the cap, so
 * callers can cheaply detect a no-op. When over the cap we keep the trailing
 * window (most recent context) and then drop any tool_result blocks whose
 * matching tool_use was sliced off the front — never the reverse, which the
 * window's contiguity already guarantees. A user message left with no content
 * after stripping orphaned tool_results is dropped entirely.
 */
export function capTeammateMessages(
  messages: readonly Message[],
  cap: number = TEAMMATE_CONTEXT_MESSAGES_CAP,
): Message[] | readonly Message[] {
  if (messages.length <= cap) return messages

  const window = messages.slice(-cap)
  const retainedToolUseIds = collectToolUseIds(window)

  const result: Message[] = []
  for (const message of window) {
    if (message.type !== 'user') {
      result.push(message)
      continue
    }

    const blocks = getBlocks(message)
    // String content or non-array content carries no tool_result — keep as is.
    if (blocks.length === 0) {
      result.push(message)
      continue
    }

    const hasToolResult = blocks.some(b => b.type === 'tool_result')
    if (!hasToolResult) {
      result.push(message)
      continue
    }

    // Keep only tool_result blocks whose tool_use survived the slice, plus any
    // non-tool_result content. Drop orphaned tool_results.
    const kept = blocks.filter(
      b =>
        b.type !== 'tool_result' ||
        (typeof b.tool_use_id === 'string' &&
          retainedToolUseIds.has(b.tool_use_id)),
    )

    if (kept.length === 0) {
      // Message was nothing but orphaned tool_results — drop it.
      continue
    }
    if (kept.length === blocks.length) {
      result.push(message)
      continue
    }

    // Some (but not all) blocks were orphaned — rebuild with the kept blocks.
    result.push({
      ...message,
      message: { ...message.message, content: kept },
    } as Message)
  }

  return result
}
