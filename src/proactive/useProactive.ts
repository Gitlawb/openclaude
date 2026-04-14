/**
 * Proactive tick hook stub for the open build.
 *
 * Imported by REPL.tsx when feature('PROACTIVE') || feature('KAIROS') is true.
 *
 * A full implementation would fire periodic <tick> prompts via onSubmitTick
 * or onQueueTick. This stub is a no-op.
 */

export function useProactive(_options: {
  isLoading: boolean
  queuedCommandsLength: number
  hasActiveLocalJsxUI: boolean
  isInPlanMode: boolean
  onSubmitTick: (prompt: string) => void
  onQueueTick: (prompt: string) => void
}): void {
  // No-op — proactive ticks disabled in stub
}
