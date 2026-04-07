export function shouldRunStartupChecks(
  isRemoteSession: boolean,
  hasStarted: boolean,
  isPromptInputActive: boolean,
): boolean {
  return !isRemoteSession && !hasStarted && !isPromptInputActive
}
