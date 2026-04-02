// Stub — snipCompact not included in source snapshot
import type { Message } from '../../types/message.js'

export const SNIP_NUDGE_TEXT = ''

export type SnipCompactResult = {
  messages: Message[]
  tokensFreed: number
  executed: boolean
  boundaryMessage?: Message
}

export function isSnipRuntimeEnabled(): boolean {
  return false
}

export function isSnipMarkerMessage(_message: Message): boolean {
  return false
}

export function snipCompactIfNeeded(
  messages: Message[],
  _options?: { force?: boolean },
): SnipCompactResult {
  return {
    messages,
    tokensFreed: 0,
    executed: false,
  }
}

export function snipCompact() {
  return null
}
