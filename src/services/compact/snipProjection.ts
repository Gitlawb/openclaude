import type { Message } from '../../types/message.js'

type SnipBoundaryCandidate = Message & {
  snipMetadata?: {
    removedUuids?: string[]
  }
}

export function isSnipBoundaryMessage(
  message: Message,
): message is SnipBoundaryCandidate {
  return (
    message.type === 'system' &&
    typeof message === 'object' &&
    message !== null &&
    'snipMetadata' in message
  )
}
