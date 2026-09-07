import type { Message } from '../types/message.js'
import type { UUID } from 'crypto'
import { createAssistantMessage, createUserInterruptionMessage, createUserMessage } from './messages.js'

/** Close tool calls before retiring a stream, so the next turn has valid history. */
export function finishInterruptedMessages(messages: Message[], streamingText?: string | null): Message[] {
  const unresolved = new Map<string, UUID>()
  for (const message of messages) {
    if (message.type !== 'assistant' && message.type !== 'user') continue
    if (!Array.isArray(message.message.content)) continue
    for (const block of message.message.content) {
      if (block.type === 'tool_use') unresolved.set(block.id, message.uuid)
      if (block.type === 'tool_result') unresolved.delete(block.tool_use_id)
    }
  }
  const result = [...messages]
  if (streamingText?.trim()) result.push(createAssistantMessage({ content: streamingText }))
  for (const [id, assistantUUID] of unresolved) {
    result.push(createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: id, is_error: true,
        content: 'Tool execution interrupted by the user.' }],
      sourceToolAssistantUUID: assistantUUID,
    }))
  }
  result.push(createUserInterruptionMessage({ toolUse: unresolved.size > 0 }))
  return result
}
