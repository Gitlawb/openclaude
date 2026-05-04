import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Message, UserMessage } from '../types/message.js'
import {
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,
} from '../constants/xml.js'
import { isSyntheticMessage, isToolUseResultMessage } from './messages.js'

function isTextBlock(block: ContentBlockParam): block is TextBlockParam {
  return block.type === 'text'
}

export function selectableUserMessagesFilter(message: Message): message is UserMessage {
  if (message.type !== 'user') {
    return false
  }
  if (Array.isArray(message.message.content) && message.message.content[0]?.type === 'tool_result') {
    return false
  }
  if (isSyntheticMessage(message)) {
    return false
  }
  if (message.isMeta) {
    return false
  }
  if (message.isCompactSummary || message.isVisibleInTranscriptOnly) {
    return false
  }
  const content = message.message.content
  const lastBlock = typeof content === 'string' ? null : content[content.length - 1]
  const messageText = typeof content === 'string' ? content.trim() : lastBlock && isTextBlock(lastBlock) ? lastBlock.text.trim() : ''

  // Filter out non-user-authored messages (command outputs, task notifications, ticks).
  if (messageText.indexOf(`<${LOCAL_COMMAND_STDOUT_TAG}>`) !== -1 || messageText.indexOf(`<${LOCAL_COMMAND_STDERR_TAG}>`) !== -1 || messageText.indexOf(`<${BASH_STDOUT_TAG}>`) !== -1 || messageText.indexOf(`<${BASH_STDERR_TAG}>`) !== -1 || messageText.indexOf(`<${TASK_NOTIFICATION_TAG}>`) !== -1 || messageText.indexOf(`<${TICK_TAG}>`) !== -1 || messageText.indexOf(`<${TEAMMATE_MESSAGE_TAG}`) !== -1) {
    return false
  }
  return true
}

/**
 * Checks if all messages after the given index are synthetic (interruptions, cancels, etc.)
 * or non-meaningful content. Returns true if there's nothing meaningful to confirm -
 * for example, if the user hit enter then immediately cancelled.
 */
export function messagesAfterAreOnlySynthetic(messages: Message[], fromIndex: number): boolean {
  for (let i = fromIndex + 1; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue

    // Skip known non-meaningful message types
    if (isSyntheticMessage(msg)) continue
    if (isToolUseResultMessage(msg)) continue
    if ((msg as any).type === 'progress') continue
    if ((msg as any).type === 'system') continue
    if ((msg as any).type === 'attachment') continue
    if ((msg as any).type === 'user' && (msg as any).isMeta) continue

    // Assistant with actual content = meaningful
    if ((msg as any).type === 'assistant') {
      const content = (msg as any).message.content
      if (Array.isArray(content)) {
        const hasMeaningfulContent = content.some(block => block.type === 'text' && block.text.trim() || block.type === 'tool_use')
        if (hasMeaningfulContent) return false
      }
      continue
    }

    // User messages that aren't synthetic or meta = meaningful
    if ((msg as any).type === 'user') {
      return false
    }

    // Other types (e.g., tombstone) are non-meaningful, continue
  }
  return true
}