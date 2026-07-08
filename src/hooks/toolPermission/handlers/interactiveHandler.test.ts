import { describe, expect, test, vi } from 'vitest'
import {
  handleInteractivePermission,
  type InteractivePermissionParams,
} from './interactiveHandler.js'

/**
 * These tests pin the watchdog pause/resume wiring in the interactive
 * permission path: `beginUserInteraction()` must run once when the dialog is
 * shown, and its resume fn must fire exactly once per terminal resolution
 * (allow/reject/abort) — and never twice, even if two branches race. This is
 * the choke-point the session-timeout fix depends on; a future resolution path
 * that bypasses `resolveOnce` would fail these tests instead of silently
 * reintroducing the original bug.
 */

type QueueItem = {
  onAbort: () => void
  onAllow: (
    updatedInput: Record<string, unknown>,
    permissionUpdates: unknown[],
    feedback?: string,
  ) => Promise<void>
  onReject: (feedback?: string) => void
}

function setup(opts?: { preAbort?: boolean; throwOnPush?: boolean }) {
  // beginUserInteraction returns a resume fn documented as "call exactly once".
  // A plain (non-idempotent) spy: a double-call would fail the "toHaveBeenCalledTimes(1)"
  // assertions, proving the handler honours that contract rather than leaning on
  // QueryGuard's internal idempotence.
  const resume = vi.fn()
  const beginUserInteraction = vi.fn(() => resume)
  let queueItem: QueueItem | undefined

  const abortController = new AbortController()
  if (opts?.preAbort) abortController.abort()

  const ctx = {
    tool: { name: 'Bash', requiresUserInteraction: () => false },
    input: {},
    assistantMessage: { message: { id: 'msg-1' } },
    toolUseID: 'tu-1',
    toolUseContext: {
      queryActivity: {
        registerActivity: vi.fn(),
        acquireLease: vi.fn(() => ({ id: '', release() {} })),
        beginUserInteraction,
      },
      abortController,
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
        mcp: { clients: [] },
      }),
    },
    pushToQueue: vi.fn((item: QueueItem) => {
      if (opts?.throwOnPush) throw new Error('setup boom')
      queueItem = item
    }),
    removeFromQueue: vi.fn(),
    updateQueueItem: vi.fn(),
    logDecision: vi.fn(),
    logCancelled: vi.fn(),
    handleUserAllow: vi.fn(async () => ({ behavior: 'allow' })),
    cancelAndAbort: vi.fn(() => ({ behavior: 'deny' })),
    buildAllow: vi.fn((input: Record<string, unknown>) => ({
      behavior: 'allow',
      updatedInput: input,
    })),
    persistPermissions: vi.fn(),
    runHooks: vi.fn(async () => null),
  }

  const resolve = vi.fn()
  const params = {
    ctx,
    description: 'desc',
    result: { behavior: 'ask' },
    // Skip the async hook/classifier races so only the dialog callbacks resolve.
    awaitAutomatedChecksBeforeDialog: true,
    bridgeCallbacks: undefined,
    channelCallbacks: undefined,
  } as unknown as InteractivePermissionParams

  let thrownError: unknown
  try {
    handleInteractivePermission(params, resolve)
  } catch (e) {
    thrownError = e
  }

  return {
    ctx,
    resume,
    beginUserInteraction,
    resolve,
    abortController,
    thrownError,
    getQueueItem: () => queueItem as QueueItem,
  }
}

describe('handleInteractivePermission watchdog suspension', () => {
  test('suspends once when the dialog is shown, before any resolution', () => {
    const { beginUserInteraction, resume } = setup()
    expect(beginUserInteraction).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()
  })

  test('resumes exactly once on allow', async () => {
    const { getQueueItem, resume, resolve } = setup()
    await getQueueItem().onAllow({}, [])
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('resumes exactly once on reject', () => {
    const { getQueueItem, resume, resolve } = setup()
    getQueueItem().onReject('no thanks')
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('resumes exactly once on abort', () => {
    const { getQueueItem, resume, resolve } = setup()
    getQueueItem().onAbort()
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('resumes only once when two resolution paths race', async () => {
    const { getQueueItem, resume, resolve } = setup()
    getQueueItem().onReject('first')
    await getQueueItem().onAllow({}, []) // loses the claim
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  // P2a: the watchdog must resume the instant the decision is claimed, before
  // post-approval async work (handleUserAllow → persistPermissions) is awaited,
  // so a stall in that work is watched again once the human has decided.
  test('resumes before awaiting post-approval async work', () => {
    const { ctx, getQueueItem, resume } = setup()
    let releaseAllow: (() => void) | undefined
    ctx.handleUserAllow = vi.fn(
      () =>
        new Promise(res => {
          releaseAllow = () => res({ behavior: 'allow' })
        }),
    )
    void getQueueItem().onAllow({}, []) // handleUserAllow stays pending
    expect(resume).toHaveBeenCalledTimes(1)
    releaseAllow?.()
  })

  // P2b: an exception in post-approval work must not strand the watchdog
  // suspended — resume happens on claim, independent of resolveOnce succeeding.
  test('resumes even when allow processing throws', async () => {
    const { ctx, getQueueItem, resume } = setup()
    ctx.handleUserAllow = vi.fn(async () => {
      throw new Error('persist failed')
    })
    await expect(getQueueItem().onAllow({}, [])).rejects.toThrow('persist failed')
    expect(resume).toHaveBeenCalledTimes(1)
  })

  // Abort that bypasses the dialog callbacks (bridge interrupt, REPL
  // backgrounding) must resume AND resolve the pending permission, so the
  // awaiter unblocks immediately instead of waiting a full idle timeout.
  test('resolves and resumes when aborted outside the dialog callbacks', () => {
    const { abortController, resume, resolve } = setup()
    expect(resume).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    abortController.abort()
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('resolves and resumes immediately if already aborted when shown', () => {
    const { ctx, resume, resolve } = setup({ preAbort: true })
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
    // Must not enqueue a prompt that is immediately stale.
    expect(ctx.pushToQueue).not.toHaveBeenCalled()
  })

  test('abort after a normal resolution does not double-resolve or double-resume', () => {
    const { abortController, getQueueItem, resume, resolve } = setup()
    getQueueItem().onReject('no')
    abortController.abort()
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  // P3: a synchronous throw during dialog setup (before any claim/resolveOnce)
  // must still resume, and the error must propagate to the caller.
  test('resumes and rethrows if dialog setup throws synchronously', () => {
    const { resume, thrownError } = setup({ throwOnPush: true })
    expect(thrownError).toBeInstanceOf(Error)
    expect((thrownError as Error).message).toBe('setup boom')
    expect(resume).toHaveBeenCalledTimes(1)
  })
})
