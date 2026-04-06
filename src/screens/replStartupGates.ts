export function shouldRunStartupChecks(
  isRemoteSession: boolean,
  hasStarted: boolean,
  promptTypingSuppressionActive: boolean,
): boolean {
  return !isRemoteSession && !hasStarted && !promptTypingSuppressionActive
}
