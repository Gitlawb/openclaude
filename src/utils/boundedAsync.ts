import { AbortError } from './errors.js'

type MapWithConcurrencyOptions = {
  signal?: AbortSignal
}

function abortReason(signal: AbortSignal, message?: string): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }
  return new AbortError(message)
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  message?: string,
): void {
  if (signal?.aborted) {
    throw abortReason(signal, message)
  }
}

export async function raceAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  message?: string,
): Promise<T> {
  if (!signal) {
    return promise
  }
  if (signal.aborted) {
    void promise.catch(() => {})
    throw abortReason(signal, message)
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      reject(abortReason(signal, message))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        cleanup()
        resolve(value)
      },
      error => {
        cleanup()
        reject(error)
      },
    )
  })
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  options?: MapWithConcurrencyOptions,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be >= 1')
  }

  const signal = options?.signal
  throwIfAborted(signal, 'operation aborted')

  const results = new Array<R>(items.length)
  let nextIndex = 0
  let failed = false

  async function worker(): Promise<void> {
    while (true) {
      if (failed) {
        return
      }
      throwIfAborted(signal, 'operation aborted')
      const index = nextIndex
      nextIndex++
      if (index >= items.length) {
        return
      }
      try {
        results[index] = await mapper(items[index]!, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await raceAbort(
    Promise.all(Array.from({ length: workerCount }, () => worker())),
    signal,
    'operation aborted',
  )
  return results
}
