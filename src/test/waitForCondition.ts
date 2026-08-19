export function createWaitForCondition(
  label: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): (predicate: () => boolean) => Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 2_000
  const intervalMs = options?.intervalMs ?? 10

  return async predicate => {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${label}`)
      }
      await Bun.sleep(intervalMs)
    }
  }
}
