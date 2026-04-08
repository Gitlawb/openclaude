export function shouldStartStartupChecks(options: {
  isRemoteSession: boolean
  promptTypingSuppressionActive: boolean
  startupChecksStarted: boolean
}): boolean {
  return (
    !options.isRemoteSession &&
    !options.promptTypingSuppressionActive &&
    !options.startupChecksStarted
  )
}
