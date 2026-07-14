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
  hasQueuedNormalPrompt = false,
}: {
  isUserInitiated: boolean
  activeQueryId: string | null
  modelBoundQueryId: string | null
  isRemoteMode: boolean
  hasQueuedNormalPrompt?: boolean
}): boolean {
  return (
    isUserInitiated &&
    !isRemoteMode &&
    !hasQueuedNormalPrompt &&
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
    isInterruptionCorrectionEligible,
    queryId,
  }: {
    shouldQuery: boolean
    isInterruptionCorrectionEligible: boolean
    queryId: string
  }): void {
    const activeQueryId = this.queryGuard.activeContext?.queryId ?? null
    if (
      shouldQuery &&
      isInterruptionCorrectionEligible &&
      activeQueryId === queryId
    ) {
      this.modelBoundQueryId = queryId
    }
  }

  async runModelTurn({
    shouldQuery,
    isInterruptionCorrectionEligible,
    queryId,
    run,
  }: {
    shouldQuery: boolean
    isInterruptionCorrectionEligible: boolean
    queryId: string
    run: () => Promise<void>
  }): Promise<void> {
    this.bindModelTurn({
      shouldQuery,
      isInterruptionCorrectionEligible,
      queryId,
    })
    try {
      await run()
    } finally {
      this.finishModelTurn(queryId)
    }
  }

  handleCancellation({
    isUserInitiated,
    isRemoteMode,
    hasQueuedNormalPrompt = false,
  }: {
    isUserInitiated: boolean
    isRemoteMode: boolean
    hasQueuedNormalPrompt?: boolean
  }): void {
    const activeQueryId = this.queryGuard.activeContext?.queryId ?? null
    if (
      shouldMarkInterruptionCorrection({
        isUserInitiated,
        activeQueryId,
        modelBoundQueryId: this.modelBoundQueryId,
        isRemoteMode,
        hasQueuedNormalPrompt,
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

  handleConversationRewrite(): void {
    this.pendingSessionId = null
  }

  restoreReminder(): void {
    this.pendingSessionId = this.getSessionId()
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
