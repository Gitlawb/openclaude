import { acquireEnvMutex, releaseEnvMutex } from '../entrypoints/sdk/shared.js'

export async function acquireSharedMutationLock(
  scope: string,
  timeoutMs?: number,
): Promise<void> {
  const result =
    timeoutMs === undefined
      ? await acquireEnvMutex()
      : await acquireEnvMutex({ timeoutMs })

  if (!result.acquired) {
    throw new Error(`Timed out acquiring shared test mutation lock for ${scope}`)
  }
}

export function releaseSharedMutationLock(): void {
  releaseEnvMutex()
}
