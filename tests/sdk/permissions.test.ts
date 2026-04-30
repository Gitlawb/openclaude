import { describe, test, expect, vi } from 'bun:test'
import {
  buildPermissionContext,
  connectSdkMcpServers,
  createDefaultCanUseTool,
  createExternalCanUseTool,
  createOnceOnlyResolve,
  createPermissionTarget,
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
    // Use createPermissionTarget which applies onceOnlyResolve at registration
    const permissionTarget = createPermissionTarget()

    const onPermissionRequest = vi.fn()
    const onTimeout = vi.fn()

    // Timeout set to 50ms with 25ms wait to trigger race condition reliably
    // This gives enough time for the test to be stable on slower systems
    // while still being fast enough to test the race condition scenario
    const timeoutMs = 50
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
    // try to resolve the same promise - but onceOnlyResolve ensures only one wins
    await new Promise(r => setTimeout(r, 25))

    const pending = permissionTarget.pendingPermissionPrompts.get(toolUseID)
    if (pending) {
      // This will race with the timeout handler's resolve call
      pending.resolve({ behavior: 'allow' as const })
    }

    // Wait for result - should NOT throw "promise already resolved" error
    // Explicitly wrap in try-catch to verify no error is thrown during race condition
    let result: PermissionResolveDecision
    let errorThrown: Error | null = null
    try {
      result = await resultPromise
    } catch (e) {
      errorThrown = e as Error
      throw new Error(`Expected no error during race condition, but got: ${errorThrown.message}`)
    }

    // Explicitly verify no error was thrown
    expect(errorThrown).toBeNull()

    // Result should be deterministic - either allow or deny, but no error
    expect(['allow', 'deny']).toContain(result!.behavior)
  })

  test('once-only resolve wrapper prevents double resolution', async () => {
    // Use createPermissionTarget which applies onceOnlyResolve at registration
    const permissionTarget = createPermissionTarget()

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
    const pending = permissionTarget.pendingPermissionPrompts.get(toolUseID)
    if (pending) {
      pending.resolve({ behavior: 'allow' as const, updatedInput: { test: true } })
    }

    // Wait for result
    const result = await resultPromise

    // Host response should win over timeout since it came first
    expect(result.behavior).toBe('allow')
    expect(onTimeout).not.toHaveBeenCalled()
  })

  test('host response after timeout is safely ignored (no double-resolve)', async () => {
    const permissionTarget = createPermissionTarget()
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

    const toolUseID = 'test-timeout-then-late-response'

    // Start the canUseTool call — this registers a pending permission
    const resultPromise = canUseTool(
      { name: 'TestTool' } as any,
      {},
      {} as any,
      {} as any,
      toolUseID,
      undefined,
    )

    // Grab a reference to the resolve BEFORE timeout fires — simulates host
    // capturing the callback while the permission prompt is still pending
    const staleResolve = permissionTarget.pendingPermissionPrompts.get(toolUseID)
    expect(staleResolve).toBeDefined()

    // Wait LONGER than the 50ms timeout — timeout fires first, resolves with deny
    const result = await resultPromise

    // Timeout should have denied
    expect(result.behavior).toBe('deny')
    expect(onTimeout).toHaveBeenCalledTimes(1)

    // Map entry cleaned up by timeout handler — no leaked listener
    expect(permissionTarget.pendingPermissionPrompts.has(toolUseID)).toBe(false)

    // NOW the host responds late through the stale reference it captured earlier.
    // This is the critical scenario: host calls resolve({allow}) AFTER timeout
    // already resolved with {deny}. onceOnlyResolve must silently ignore this.
    // Wrap in try/catch to explicitly verify no error from double-resolve attempt.
    let lateResponseError: Error | null = null
    try {
      staleResolve!.resolve({ behavior: 'allow' as const, updatedInput: { injected: true } })
    } catch (e) {
      lateResponseError = e as Error
    }

    // No error thrown — onceOnlyResolve silently swallowed the second resolve
    expect(lateResponseError).toBeNull()

    // Result stays 'deny' — timeout decision is immutable
    expect(result.behavior).toBe('deny')
    expect((result as any).updatedInput).toBeUndefined()
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

  test('timeout-deny-then-host-allow: raw resolve called exactly once', () => {
    // This directly proves onceOnlyResolve prevents the raw resolve from being
    // called a second time — the exact scenario the reviewer asked about:
    // timeout fires first (deny), then host responds (allow) — raw resolve
    // must only execute once.
    let rawCallCount = 0
    let rawResolvedValue: PermissionResolveDecision | undefined

    const rawResolve = (value: PermissionResolveDecision) => {
      rawCallCount++
      rawResolvedValue = value
    }

    const wrapped = createOnceOnlyResolve(rawResolve)

    // Step 1: Timeout fires first — resolves with deny
    wrapped({ behavior: 'deny', message: 'Permission resolution timed out' })
    expect(rawCallCount).toBe(1)
    expect(rawResolvedValue!.behavior).toBe('deny')

    // Step 2: Host responds late with allow — must be ignored
    wrapped({ behavior: 'allow' as const, updatedInput: { injected: true } })
    expect(rawCallCount).toBe(1) // NOT 2 — second call was a no-op
    expect(rawResolvedValue!.behavior).toBe('deny') // Unchanged
    expect((rawResolvedValue as any).updatedInput).toBeUndefined()
  })
})

describe('createPermissionTarget', () => {
  test('creates permission target with wrapped resolve', () => {
    const target = createPermissionTarget()
    expect(target.pendingPermissionPrompts).toBeDefined()
    expect(target.registerPendingPermission).toBeDefined()
  })

  test('registerPendingPermission stores wrapped resolve', async () => {
    const target = createPermissionTarget()
    const toolUseId = 'test-id'

    // Register should create a promise
    const promise = target.registerPendingPermission(toolUseId)

    // The resolve should be stored in the map
    const pending = target.pendingPermissionPrompts.get(toolUseId)
    expect(pending).toBeDefined()

    // Calling resolve twice should only resolve once (onceOnlyResolve behavior)
    pending!.resolve({ behavior: 'allow' as const })
    pending!.resolve({ behavior: 'deny' as const, message: 'should not happen', decisionReason: { type: 'mode', mode: 'default' } })

    // Promise should resolve with 'allow' (first call)
    const result = await promise
    expect(result.behavior).toBe('allow')
  })
})

describe('createExternalCanUseTool error handling', () => {
  test('includes original error message in denial', async () => {
    const userFn = async () => {
      throw new Error('Custom error from callback')
    }

    const permissionTarget = {
      registerPendingPermission: async () => ({ behavior: 'deny' as const }),
      pendingPermissionPrompts: new Map(),
    }

    const canUseTool = createExternalCanUseTool(
      userFn,
      async () => ({ behavior: 'deny' as const, message: 'fallback' }),
      permissionTarget,
    )

    const result = await canUseTool(
      { name: 'TestTool' } as any,
      {},
      {} as any,
      {} as any,
      'test-id',
      undefined,
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('Custom error from callback')
  })
})

describe('createExternalCanUseTool timeout scenarios', () => {
  test('emits timeout message when host does not respond', async () => {
    // Use createPermissionTarget which applies onceOnlyResolve at registration
    const permissionTarget = createPermissionTarget()

    const onPermissionRequest = vi.fn()
    const onTimeout = vi.fn()

    const canUseTool = createExternalCanUseTool(
      undefined,
      async () => ({ behavior: 'deny' as const, message: 'fallback' }),
      permissionTarget,
      onPermissionRequest,
      onTimeout,
      50, // 50ms timeout for fast test
    )

    const result = await canUseTool(
      { name: 'TestTool' } as any,
      {},
      {} as any,
      {} as any,
      'test-id',
      undefined,
    )

    expect(result.behavior).toBe('deny')
    // When timeout occurs, the implementation calls onTimeout and falls through to fallback
    expect(result.message).toBe('fallback')
    expect(onTimeout).toHaveBeenCalled()
    expect(onTimeout.mock.calls[0][0].type).toBe('permission_timeout')
    expect(onTimeout.mock.calls[0][0].tool_name).toBe('TestTool')
    expect(onTimeout.mock.calls[0][0].timed_out_after_ms).toBe(50)
  })

  test('fallback is used when no onPermissionRequest callback', async () => {
    const permissionTarget = createPermissionTarget()

    const canUseTool = createExternalCanUseTool(
      undefined,
      async () => ({ behavior: 'deny' as const, message: 'fallback denial' }),
      permissionTarget,
      // No onPermissionRequest callback
    )

    const result = await canUseTool(
      { name: 'TestTool' } as any,
      {},
      {} as any,
      {} as any,
      'test-id',
      undefined,
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toBe('fallback denial')
  })
})

describe('connectSdkMcpServers error handling', () => {
  test('returns empty arrays for undefined config', async () => {
    const result = await connectSdkMcpServers(undefined)

    expect(result.clients).toEqual([])
    expect(result.tools).toEqual([])
  })

  test('returns empty arrays for empty config', async () => {
    const result = await connectSdkMcpServers({})

    expect(result.clients).toEqual([])
    expect(result.tools).toEqual([])
  })
})
