export type CriticalInputDialog =
  | 'sandbox-permission'
  | 'tool-permission'
  | 'prompt'
  | 'worker-sandbox-permission'
  | 'elicitation'
  | 'cost';

/**
 * Permission and hook prompts must take focus immediately. Suppressing them
 * while the user has draft input only shows "Waiting for permission…" without
 * the actual question until input is cleared (issue #651).
 */
export function resolveCriticalInputDialog(options: {
  sandboxPermissionPending: boolean;
  toolUseConfirmPending: boolean;
  promptPending: boolean;
  workerSandboxPermissionPending: boolean;
  elicitationPending: boolean;
  showingCostDialog: boolean;
  allowDialogsWithAnimation: boolean;
}): CriticalInputDialog | undefined {
  if (options.sandboxPermissionPending) return 'sandbox-permission';
  if (options.allowDialogsWithAnimation && options.toolUseConfirmPending) {
    return 'tool-permission';
  }
  if (options.allowDialogsWithAnimation && options.promptPending) return 'prompt';
  if (options.allowDialogsWithAnimation && options.workerSandboxPermissionPending) {
    return 'worker-sandbox-permission';
  }
  if (options.allowDialogsWithAnimation && options.elicitationPending) {
    return 'elicitation';
  }
  if (options.allowDialogsWithAnimation && options.showingCostDialog) {
    return 'cost';
  }
  return undefined;
}
