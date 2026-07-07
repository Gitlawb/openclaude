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

function setup() {
  const resume = vi.fn()
  const beginUserInteraction = vi.fn(() => resume)
  let queueItem: QueueItem | undefined

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
      abortController: new AbortController(),
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
        mcp: { clients: [] },
      }),
    },
    pushToQueue: vi.fn((item: QueueItem) => {
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

  handleInteractivePermission(params, resolve)

  return {
    resume,
    beginUserInteraction,
    resolve,
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
})
