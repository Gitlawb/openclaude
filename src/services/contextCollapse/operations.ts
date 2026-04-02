import type { Message } from '../../types/message.js'

export function projectView<T extends Message>(messages: T[]): T[] {
  return messages
}
