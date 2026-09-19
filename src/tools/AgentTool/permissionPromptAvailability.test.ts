import { describe, expect, test } from 'bun:test'
import { shouldAvoidAgentPermissionPrompts } from './permissionPromptAvailability.js'

describe('shouldAvoidAgentPermissionPrompts', () => {
  test('forwards async agent prompts through an interactive parent session', () => {
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: true,
        permissionMode: 'acceptEdits',
        isNonInteractiveSession: false,
      }),
    ).toBe(false)
  })

  test('keeps async agents fail-closed in non-interactive sessions', () => {
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: true,
        permissionMode: 'acceptEdits',
        isNonInteractiveSession: true,
      }),
    ).toBe(true)
  })

  test('propagates an interactive parent prompt through nested async agents', () => {
    const parentShouldAvoidPrompts = shouldAvoidAgentPermissionPrompts({
      isAsync: true,
      permissionMode: 'acceptEdits',
      isNonInteractiveSession: false,
    })

    expect(parentShouldAvoidPrompts).toBe(false)
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: true,
        canShowPermissionPrompts: !parentShouldAvoidPrompts,
        permissionMode: 'acceptEdits',
        // Async child contexts use this flag for query behavior, so prompt
        // capability must be propagated independently.
        isNonInteractiveSession: true,
      }),
    ).toBe(false)
  })

  test('preserves synchronous and bubble prompt behavior', () => {
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: false,
        permissionMode: 'acceptEdits',
        isNonInteractiveSession: true,
      }),
    ).toBe(false)
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: true,
        permissionMode: 'bubble',
        isNonInteractiveSession: true,
      }),
    ).toBe(false)
  })

  test('honors an explicit caller override', () => {
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: true,
        canShowPermissionPrompts: true,
        permissionMode: 'acceptEdits',
        isNonInteractiveSession: true,
      }),
    ).toBe(false)
    expect(
      shouldAvoidAgentPermissionPrompts({
        isAsync: false,
        canShowPermissionPrompts: false,
        permissionMode: 'bubble',
        isNonInteractiveSession: false,
      }),
    ).toBe(true)
  })
})
