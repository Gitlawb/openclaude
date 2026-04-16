/**
 * Run up to `limit` async tasks in parallel, preserving input order in output.
 * Rejected tasks do not abort others — the rejection surfaces at its index.
 */
export async function runWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let next = 0

  async function worker() {
    while (next < tasks.length) {
      const idx = next++
      try {
        const value = await tasks[idx]()
        results[idx] = { status: 'fulfilled', value }
      } catch (reason) {
        results[idx] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/** Centralized default so tests can reference it. */
export function defaultConcurrency(): number {
  return 4
}
