import { describe, expect, test } from 'bun:test'
import { createSharedMutationLockForTesting } from './sharedMutationLock.js'

describe('sharedMutationLock', () => {
  test('uses the default timeout when no timeout is provided', async () => {
    const lock = createSharedMutationLockForTesting(20)

    await lock.acquireSharedMutationLock('default-timeout-holder')
    try {
      await expect(
        lock.acquireSharedMutationLock('default-timeout-waiter'),
      ).rejects.toThrow(
        'Timed out after 20ms acquiring shared test mutation lock for default-timeout-waiter',
      )
    } finally {
      lock.releaseSharedMutationLock()
    }
  })

  test('honors an explicit timeout override in the scoped error', async () => {
    const lock = createSharedMutationLockForTesting()

    await lock.acquireSharedMutationLock('custom-timeout-holder')
    try {
      await expect(
        lock.acquireSharedMutationLock('custom-timeout-waiter', 10),
      ).rejects.toThrow(
        'Timed out after 10ms acquiring shared test mutation lock for custom-timeout-waiter',
      )
    } finally {
      lock.releaseSharedMutationLock()
    }
  })

  test('release allows the next waiter to acquire the lock', async () => {
    const lock = createSharedMutationLockForTesting()

    await lock.acquireSharedMutationLock('first-holder')
    const waiter = lock.acquireSharedMutationLock('next-waiter')
    lock.releaseSharedMutationLock()

    await expect(waiter).resolves.toBeUndefined()
    lock.releaseSharedMutationLock()
  })
})
