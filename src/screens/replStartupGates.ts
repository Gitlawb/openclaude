/**
 * Startup gates for the REPL.
 *
 * Prevents startup plugin checks and recommendation dialogs from stealing
 * focus before the user has interacted with the prompt.
 *
 * This addresses the root cause of issue #363: on mount, performStartupChecks
 * triggers plugin loading, which populates trackedFiles, which triggers
 * useLspPluginRecommendation to surface an LSP recommendation dialog. Since
 * promptTypingSuppressionActive is false before the user has typed anything,
 * getFocusedInputDialog() returns the dialog, unmounting PromptInput entirely.
 *
 * The fix gates startup checks on actual prompt interaction. A pure timeout
 * or grace period is insufficient because pausing before typing would still
 * allow dialogs to steal focus. Only the user's first submission guarantees
 * the prompt is no longer in the vulnerable pre-interaction window.
 */

/**
 * Determines whether startup checks should run.
 *
 * Startup checks are deferred until the user has submitted their first
 * message. This guarantees the prompt was the first thing the user interacted
 * with, so no recommendation dialog can steal focus before the first keystroke.
 */
export function shouldRunStartupChecks(options: {
  isRemoteSession: boolean;
  hasStarted: boolean;
  hasHadFirstSubmission: boolean;
}): boolean {
  if (options.isRemoteSession) return false;
  if (options.hasStarted) return false;
  if (!options.hasHadFirstSubmission) return false;
  return true;
}