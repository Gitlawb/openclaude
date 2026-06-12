// Stub — contextCollapse not included in source snapshot (feature-gated).
// projectView is the read-side projection of committed collapses onto the
// message history; with no collapses it is the identity function.
import type { Message } from '../../types/message.js'

/**
 * Project committed collapses onto the API view of the conversation.
 * Inert: no collapses ever exist in this snapshot, so this returns the
 * input unchanged.
 */
export function projectView(messages: Message[]): Message[] {
  return messages
}
