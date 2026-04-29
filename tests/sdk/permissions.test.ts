import { describe, test, expect, vi } from 'bun:test'
import {
  buildPermissionContext,
  createDefaultCanUseTool,
  createExternalCanUseTool,
  createOnceOnlyResolve,
} from '../../src/entrypoints/sdk/permissions.js'
import type { PermissionResolveDecision } from '../../src/entrypoints/sdk/permissions.js'
import { getEmptyToolPermissionContext } from '../../src/Tool.js'

describe('buildPermissionContext', () => {
  test('returns default mode when no permissionMode specified', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp' })
    expect(ctx.mode).toBe('default')
  })

  test('maps plan mode correctly', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'plan' })
    expect(ctx.mode).toBe('plan')
  })

  test('maps auto-accept to acceptEdits', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'auto-accept' })
    expect(ctx.mode).toBe('acceptEdits')
  })

  test('maps acceptEdits mode', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'acceptEdits' })
    expect(ctx.mode).toBe('acceptEdits')
  })

  test('maps bypass-permissions mode', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'bypass-permissions' })
    expect(ctx.mode).toBe('bypassPermissions')
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('maps bypassPermissions mode', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'bypassPermissions' })
    expect(ctx.mode).toBe('bypassPermissions')
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('default mode does not have bypass available', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp' })
    expect(ctx.isBypassPermissionsModeAvailable).toBe(false)
  })

  test('allowDangerouslySkipPermissions sets bypass flag', () => {
    const ctx = buildPermissionContext({
      cwd: '/tmp',
      allowDangerouslySkipPermissions: true,
    })
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('additionalDirectories are added to context', () => {
    const ctx = buildPermissionContext({
      cwd: '/tmp',
      additionalDirectories: ['/dir1', '/dir2'],
    })
    expect(ctx.additionalWorkingDirectories.has('/dir1')).toBe(true)
    expect(ctx.additionalWorkingDirectories.has('/dir2')).toBe(true)
  })

  test('empty additionalDirectories does nothing', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', additionalDirectories: [] })
    expect(ctx.additionalWorkingDirectories.size).toBe(0)
  })
})

describe('createDefaultCanUseTool', () => {
  test('denies all tool uses', async () => {
    const ctx = getEmptyToolPermissionContext()
    const canUseTool = createDefaultCanUseTool(ctx)

    const result = await canUseTool(
      { name: 'Bash' } as any,
      { command: 'rm -rf /' },
      {} as any,
      {} as any,
      undefined,
      undefined,
    )

    expect(result.behavior).toBe('deny')
  })

  test('honors forceDecision when provided', async () => {
    const ctx = getEmptyToolPermissionContext()
    const canUseTool = createDefaultCanUseTool(ctx)

    const forced = { behavior: 'allow' as const }
    const result = await canUseTool(
      { name: 'Bash' } as any,
      {},
      {} as any,
      {} as any,
      undefined,
      forced,
    )

    expect(result.behavior).toBe('allow')
  })
})

describe('createExternalCanUseTool race condition', () => {
  test('handles simultaneous timeout and response correctly', async () => {
    const pendingPermissionPrompts = new Map<string, { resolve: (decision: PermissionResolveDecision) => void }>()

    const registerPendingPermission = (toolUseId: string): Promise<PermissionResolveDecision> => {
      return new Promise(resolve => {
        pendingPermissionPrompts.set(toolUseId, { resolve })
      })
    }

    const permissionTarget = {
      registerPendingPermission,
      pendingPermissionPrompts,
    }

    const onPermissionRequest = vi.fn()
    const onTimeout = vi.fn()

    // Very short timeout to trigger race condition
    const timeoutMs = 10
    const canUseTool = createExternalCanUseTool(
      undefined,
      async () => ({ behavior: 'deny' as const, message: 'fallback' }),
      permissionTarget,
      onPermissionRequest,
      onTimeout,
      timeoutMs,
    )

    const toolUseID = 'test-tool-use-id'

    // Start the canUseTool call
    const resultPromise = canUseTool(
      { name: 'TestTool' } as any,
      {},
      {} as any,
      {} as any,
      toolUseID,
      undefined,
    )

    // Simulate host responding right at timeout threshold
    // This creates the race condition scenario where both timeout and host
    // try to resolve the same promise
    await new Promise(r => setTimeout(r, timeoutMs))

    const pending = pendingPermissionPrompts.get(toolUseID)
    if (pending) {
      // This will race with the timeout handler's resolve call
      pending.resolve({ behavior: 'allow' as const })
    }

    // Wait for result - should NOT throw "promise already resolved" error
    const result = await resultPromise

    // Result should be deterministic - either allow or deny, but no error
    expect(['allow', 'deny']).toContain(result.behavior)
  })

  test('once-only resolve wrapper prevents double resolution', async () => {
    const pendingPermissionPrompts = new Map<string, { resolve: (decision: PermissionResolveDecision) => void }>()

    const registerPendingPermission = (toolUseId: string): Promise<PermissionResolveDecision> => {
      return new Promise(resolve => {
        pendingPermissionPrompts.set(toolUseId, { resolve })
      })
    }

    const permissionTarget = {
      registerPendingPermission,
      pendingPermissionPrompts,
    }

    const onPermissionRequest = vi.fn()
    const onTimeout = vi.fn()

    const canUseTool = createExternalCanUseTool(
      undefined,
      async () => ({ behavior: 'deny' as const, message: 'fallback' }),
      permissionTarget,
      onPermissionRequest,
      onTimeout,
      50, // 50ms timeout
    )

    const toolUseID = 'test-tool-use-id-race'

    // Start the canUseTool call
    const resultPromise = canUseTool(
      { name: 'TestTool' } as any,
      {},
      {} as any,
      {} as any,
      toolUseID,
      undefined,
    )

    // Respond immediately after starting to simulate very fast host response
    // This tests that the first response wins, not the timeout
    const pending = pendingPermissionPrompts.get(toolUseID)
    if (pending) {
      pending.resolve({ behavior: 'allow' as const, updatedInput: { test: true } })
    }

    // Wait for result
    const result = await resultPromise

    // Host response should win over timeout since it came first
    expect(result.behavior).toBe('allow')
    expect(onTimeout).not.toHaveBeenCalled()
  })
})

describe('createOnceOnlyResolve', () => {
  test('only resolves once when called multiple times', () => {
    let resolvedValue: string | undefined
    let callCount = 0

    const resolve = (value: string) => {
      callCount++
      resolvedValue = value
    }

    const onceOnlyResolve = createOnceOnlyResolve(resolve)

    // First call should resolve
    onceOnlyResolve('first')
    expect(resolvedValue).toBe('first')
    expect(callCount).toBe(1)

    // Second call should be ignored
    onceOnlyResolve('second')
    expect(resolvedValue).toBe('first') // Still 'first', not 'second'
    expect(callCount).toBe(1) // Still 1, not incremented

    // Third call should also be ignored
    onceOnlyResolve('third')
    expect(resolvedValue).toBe('first')
    expect(callCount).toBe(1)
  })

  test('works with Promise resolution', async () => {
    let resolveFunc: (value: string) => void
    const promise = new Promise<string>(resolve => {
      resolveFunc = resolve
    })

    const onceOnlyResolve = createOnceOnlyResolve(resolveFunc!)

    // Resolve twice rapidly
    onceOnlyResolve('first')
    onceOnlyResolve('second')

    // Promise should resolve with 'first' only
    const result = await promise
    expect(result).toBe('first')
  })

  test('handles undefined and null values', () => {
    let resolvedValue: string | null | undefined = 'initial'

    const resolve = (value: string | null | undefined) => {
      resolvedValue = value
    }

    const onceOnlyResolve = createOnceOnlyResolve(resolve)

    onceOnlyResolve(undefined)
    expect(resolvedValue).toBeUndefined()

    onceOnlyResolve('should not change')
    expect(resolvedValue).toBeUndefined() // Still undefined

    onceOnlyResolve(null)
    expect(resolvedValue).toBeUndefined() // Still undefined
  })
})
