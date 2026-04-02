import type { Message } from '../../types/message.js'

export function isSnipBoundaryMessage(message: Message): boolean {
  return message.type === 'system' && message.subtype === 'compact_boundary'
}

export function projectSnippedView(messages: Message[]): Message[] {
  return messages
}
