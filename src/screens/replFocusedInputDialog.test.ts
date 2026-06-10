import { describe, expect, it } from 'bun:test';

import { resolveCriticalInputDialog } from './replFocusedInputDialog.js';

const idle = {
  sandboxPermissionPending: false,
  toolUseConfirmPending: false,
  promptPending: false,
  workerSandboxPermissionPending: false,
  elicitationPending: false,
  showingCostDialog: false,
  allowDialogsWithAnimation: true,
};

describe('resolveCriticalInputDialog', () => {
  it('returns tool-permission even when typing suppression would block lower dialogs', () => {
    expect(
      resolveCriticalInputDialog({
        ...idle,
        toolUseConfirmPending: true,
      }),
    ).toBe('tool-permission');
  });

  it('returns hook prompt when pending', () => {
    expect(
      resolveCriticalInputDialog({
        ...idle,
        promptPending: true,
      }),
    ).toBe('prompt');
  });

  it('respects allowDialogsWithAnimation for non-sandbox dialogs', () => {
    expect(
      resolveCriticalInputDialog({
        ...idle,
        toolUseConfirmPending: true,
        allowDialogsWithAnimation: false,
      }),
    ).toBeUndefined();
  });

  it('always returns sandbox-permission regardless of animation gate', () => {
    expect(
      resolveCriticalInputDialog({
        ...idle,
        sandboxPermissionPending: true,
        allowDialogsWithAnimation: false,
      }),
    ).toBe('sandbox-permission');
  });

  it('prioritizes sandbox permission over tool permission', () => {
    expect(
      resolveCriticalInputDialog({
        ...idle,
        sandboxPermissionPending: true,
        toolUseConfirmPending: true,
      }),
    ).toBe('sandbox-permission');
  });
});
