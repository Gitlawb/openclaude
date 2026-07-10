import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { isToolReferenceBlock } from '../toolSearch.js'

/**
 * Derive a short stable message ID (6-char base36 string) from a UUID.
 * Used for snip tool referencing — injected into API-bound messages as internal
 * system-reminder metadata.
 * Deterministic: same UUID always produces the same short ID.
 */
export function deriveShortMessageId(uuid: string): string {
  // Take first 10 hex chars from the UUID (skipping dashes)
  const hex = uuid.replace(/-/g, '').slice(0, 10)
  // Convert to base36 for shorter representation, take 6 chars
  return parseInt(hex, 16).toString(36).slice(0, 6)
}

/**
 * Appends internal snip metadata to the last text block of a user message.
 * Only mutates the API-bound copy, not the stored message.
 * This lets Claude reference message IDs when calling the snip tool.
 */
export function appendMessageTagToUserMessage(
  message: UserMessage,
): UserMessage {
  // isCollapseSummary blocks must never carry a snip id: the model could queue
  // the only replacement for an archived span for removal. A merge can clear
  // isMeta while keeping isCollapseSummary, so both are checked here.
  if (message.isMeta || message.isCollapseSummary) {
    return message
  }

  const idToken = deriveShortMessageId(message.uuid)
  const tag =
    `\n<system-reminder>snip_id=${idToken}; system-generated; ` +
    `for snip tool use only; do not discuss in thinking or responses.</system-reminder>`

  const content = message.message.content

  // Idempotency: normalizeMessagesForAPI re-runs over messages that are carried
  // forward as loop state (query.ts builds toolResults from this function's own
  // normalized output, then re-normalizes that state next turn). Without this
  // guard each pass stacks another internal marker on every prior tool result. The
  // token is derived from this message's own uuid, so its presence inside the
  // internal marker means we already tagged it (string body, last text block, or
  // the dedicated tool_result text block). Leave it untouched.
  const alreadyTagged =
    typeof content === 'string'
      ? content.includes(`snip_id=${idToken}`)
      : Array.isArray(content) &&
        content.some(
          block =>
            block!.type === 'text' &&
            (block as TextBlockParam).text.includes(`snip_id=${idToken}`),
        )
  if (alreadyTagged) {
    return message
  }

  // Handle string content (most common for simple text input)
  if (typeof content === 'string') {
    return {
      ...message,
      message: {
        ...message.message,
        content: content + tag,
      },
    }
  }

  if (!Array.isArray(content) || content.length === 0) {
    return message
  }

  // Find the last text block
  let lastTextIdx = -1
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i]!.type === 'text') {
      lastTextIdx = i
      break
    }
  }
  if (lastTextIdx === -1) {
    // Pure tool_result messages (large Read/Bash outputs) carry no text block
    // to host the metadata, yet they are the highest-value snip targets. Append
    // a dedicated text block so the model can see the internal snip id without
    // making it look user-authored. The tool_result block is left intact, so
    // snip pairing is unaffected.
    if (!content.some(block => block!.type === 'tool_result')) {
      return message
    }
    return {
      ...message,
      message: {
        ...message.message,
        content: [
          ...content,
          { type: 'text' as const, text: tag.replace(/^\n/, '') },
        ] as typeof content,
      },
    }
  }

  const newContent = [...content]
  const textBlock = newContent[lastTextIdx] as TextBlockParam
  newContent[lastTextIdx] = {
    ...textBlock,
    text: textBlock.text + tag,
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: newContent as typeof content,
    },
  }
}
// Matches the exact internal snip marker appended by appendMessageTagToUserMessage
// (with or without the leading newline used for the no-text-block variant). The
// body has no '<' chars, so [^<]* terminates cleanly at the closing tag.
const SNIP_TAG_PATTERN =
  /\n?<system-reminder>snip_id=[^<]*<\/system-reminder>/g

/**
 * Remove any internal snip marker from user content. Used when a merge folds a
 * collapse summary into a real user turn: the real turn may have been tagged
 * before the merge, and the merged block must not present a snip id (it carries
 * the only replacement for an archived span).
 */
export function stripSnipTagsFromContent(
  content: string | ContentBlockParam[],
): string | ContentBlockParam[] {
  if (typeof content === 'string') {
    return content.replace(SNIP_TAG_PATTERN, '')
  }
  if (!Array.isArray(content)) return content
  const result: ContentBlockParam[] = []
  for (const block of content) {
    if (block?.type === 'text') {
      const original = (block as TextBlockParam).text
      const text = original.replace(SNIP_TAG_PATTERN, '')
      // Drop a text block whose only content was the snip marker; sending an
      // empty text block alongside the collapse summary is invalid. Pre-existing
      // empty blocks are left untouched so this stays scoped to the merge path.
      if (text === '' && original !== '') continue
      result.push({ ...block, text })
    } else {
      result.push(block)
    }
  }
  return result
}

/**
 * Strips tool_reference blocks from tool_result content in a user message.
 * tool_reference blocks are only valid when the tool search beta is enabled.
 * When tool search is disabled, we need to remove these blocks to avoid API errors.
 */
export function stripToolReferenceBlocksFromUserMessage(
  message: UserMessage,
): UserMessage {
  const content = message.message.content
  if (!Array.isArray(content)) {
    return message
  }

  const hasToolReference = content.some(
    block =>
      block.type === 'tool_result' &&
      Array.isArray(block.content) &&
      block.content.some(isToolReferenceBlock),
  )

  if (!hasToolReference) {
    return message
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: content.map(block => {
        if (block.type !== 'tool_result' || !Array.isArray(block.content)) {
          return block
        }

        // Filter out tool_reference blocks from tool_result content
        const filteredContent = block.content.filter(
          c => !isToolReferenceBlock(c),
        )

        // If all content was tool_reference blocks, replace with a placeholder
        if (filteredContent.length === 0) {
          return {
            ...block,
            content: [
              {
                type: 'text' as const,
                text: '[Tool references removed - tool search not enabled]',
              },
            ],
          }
        }

        return {
          ...block,
          content: filteredContent,
        }
      }),
    },
  }
}

/**
 * Strips the 'caller' field from tool_use blocks in an assistant message.
 * The 'caller' field is only valid when the tool search beta is enabled.
 * When tool search is disabled, we need to remove this field to avoid API errors.
 *
 * NOTE: This function only strips the 'caller' field - it does NOT normalize
 * tool inputs (that's done by normalizeToolInputForAPI in normalizeMessagesForAPI).
 * This is intentional: this helper is used for model-specific post-processing
 * AFTER normalizeMessagesForAPI has already run, so inputs are already normalized.
 */
export function stripCallerFieldFromAssistantMessage(
  message: AssistantMessage,
): AssistantMessage {
  const hasCallerField = message.message.content.some(
    block =>
      block.type === 'tool_use' && 'caller' in block,
  )

  if (!hasCallerField) {
    return message
  }

  return {
    ...message,
    message: {
      ...message.message,
      content: message.message.content.map(block => {
        if (block.type !== 'tool_use') {
          return block
        }
        // Explicitly construct with only standard API fields
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
          // extra_content is a non-SDK extension field — cast type-side only
          ...((block as { extra_content?: unknown }).extra_content
            ? {
                extra_content: (block as { extra_content?: unknown })
                  .extra_content,
              }
            : {})
        }
      }),
    },
  }
}
