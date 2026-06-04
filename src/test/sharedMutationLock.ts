import {
  acquireEnvMutex,
  createEnvMutexForTesting,
  releaseEnvMutex,
  type MutexAcquireOptions,
  type MutexAcquireResult,
} from '../entrypoints/sdk/shared.js'

type AcquireEnvMutex = (
  options?: MutexAcquireOptions,
) => Promise<MutexAcquireResult>

export const DEFAULT_SHARED_MUTATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000

function createSharedMutationLock(
  acquire: AcquireEnvMutex,
  release: () => void,
  defaultTimeoutMs: number,
) {
  return {
    async acquireSharedMutationLock(
      scope: string,
      timeoutMs?: number,
    ): Promise<void> {
      const effectiveTimeoutMs = timeoutMs ?? defaultTimeoutMs
      const result = await acquire({ timeoutMs: effectiveTimeoutMs })

      if (!result.acquired) {
        throw new Error(
          `Timed out after ${effectiveTimeoutMs}ms acquiring shared test mutation lock for ${scope}`,
        )
      }
    },
    releaseSharedMutationLock(): void {
      release()
    },
  }
}

const sharedMutationLock = createSharedMutationLock(
  acquireEnvMutex,
  releaseEnvMutex,
  DEFAULT_SHARED_MUTATION_LOCK_TIMEOUT_MS,
)

export const acquireSharedMutationLock =
  sharedMutationLock.acquireSharedMutationLock

export function releaseSharedMutationLock(): void {
  sharedMutationLock.releaseSharedMutationLock()
}

export function createSharedMutationLockForTesting(defaultTimeoutMs = 50) {
  const isolated = createEnvMutexForTesting()
  return createSharedMutationLock(
    isolated.acquireEnvMutex,
    isolated.releaseEnvMutex,
    defaultTimeoutMs,
  )
}
