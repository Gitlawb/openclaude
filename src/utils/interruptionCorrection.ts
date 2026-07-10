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

export class InterruptionCorrectionTracker {
  private pendingSessionId: string | null = null
  private modelBoundQueryId: string | null = null

  bindModelTurn({
    shouldQuery,
    isAborted,
    activeQueryId,
    queryId,
  }: {
    shouldQuery: boolean
    isAborted: boolean
    activeQueryId: string | null
    queryId: string
  }): void {
    if (shouldQuery && !isAborted && activeQueryId === queryId) {
      this.modelBoundQueryId = queryId
    }
  }

  handleCancellation({
    isUserInitiated,
    activeQueryId,
    isRemoteMode,
    sessionId,
  }: {
    isUserInitiated: boolean
    activeQueryId: string | null
    isRemoteMode: boolean
    sessionId: string
  }): void {
    if (
      shouldMarkInterruptionCorrection({
        isUserInitiated,
        activeQueryId,
        modelBoundQueryId: this.modelBoundQueryId,
        isRemoteMode,
      })
    ) {
      this.pendingSessionId = sessionId
    }
    if (
      activeQueryId !== null &&
      activeQueryId === this.modelBoundQueryId
    ) {
      this.modelBoundQueryId = null
    }
  }

  finishModelTurn(queryId: string): void {
    if (this.modelBoundQueryId === queryId) {
      this.modelBoundQueryId = null
    }
  }

  takeReminder(sessionId: string): UserMessage | null {
    const result = consumeInterruptionCorrectionReminder(
      this.pendingSessionId,
      sessionId,
    )
    this.pendingSessionId = result.pendingSessionId
    return result.reminder
  }
}
