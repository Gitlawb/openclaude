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

  constructor(
    private readonly queryGuard: {
      readonly activeContext: { queryId: string } | null
    },
    private readonly getSessionId: () => string,
  ) {}

  bindModelTurn({
    shouldQuery,
    isAborted,
    queryId,
  }: {
    shouldQuery: boolean
    isAborted: boolean
    queryId: string
  }): void {
    const activeQueryId = this.queryGuard.activeContext?.queryId ?? null
    if (shouldQuery && !isAborted && activeQueryId === queryId) {
      this.modelBoundQueryId = queryId
    }
  }

  handleCancellation({
    isUserInitiated,
    isRemoteMode,
  }: {
    isUserInitiated: boolean
    isRemoteMode: boolean
  }): void {
    const activeQueryId = this.queryGuard.activeContext?.queryId ?? null
    if (
      shouldMarkInterruptionCorrection({
        isUserInitiated,
        activeQueryId,
        modelBoundQueryId: this.modelBoundQueryId,
        isRemoteMode,
      })
    ) {
      this.pendingSessionId = this.getSessionId()
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

  takeReminder(): UserMessage | null {
    const result = consumeInterruptionCorrectionReminder(
      this.pendingSessionId,
      this.getSessionId(),
    )
    this.pendingSessionId = result.pendingSessionId
    return result.reminder
  }
}
