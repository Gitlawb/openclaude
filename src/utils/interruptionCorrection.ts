import type { UserMessage } from '../types/message.js'
import { createUserMessage } from './messages/factories.js'

export const INTERRUPTION_CORRECTION_REMINDER = `<system-reminder>
The previous assistant turn was interrupted by the user. Treat the user's latest message as a correction and do not continue the interrupted plan unless explicitly asked.
</system-reminder>`

export function shouldMarkInterruptionCorrection({
  isUserInitiated,
  activeQueryId,
  modelBoundQueryId,
  isRemoteMode,
}: {
  isUserInitiated: boolean
  activeQueryId: string | null
  modelBoundQueryId: string | null
  isRemoteMode: boolean
}): boolean {
  return (
    isUserInitiated &&
    !isRemoteMode &&
    activeQueryId !== null &&
    activeQueryId === modelBoundQueryId
  )
}

export function consumeInterruptionCorrectionReminder(
  pendingSessionId: string | null,
  currentSessionId: string,
): { pendingSessionId: null; reminder: UserMessage | null } {
  return {
    pendingSessionId: null,
    reminder: pendingSessionId === currentSessionId
      ? createUserMessage({
          content: INTERRUPTION_CORRECTION_REMINDER,
          isMeta: true,
        })
      : null,
  }
}
