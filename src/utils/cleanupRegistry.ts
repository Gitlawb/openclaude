/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => void | Promise<void>>()

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
export function registerCleanup(cleanupFn: () => void | Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}

/**
 * Run all registered cleanup functions.
 * Used internally by gracefulShutdown.
 */
export async function runCleanupFunctions(): Promise<void> {
  await Promise.all(Array.from(cleanupFunctions).map(fn => fn()))
}

// --- Cleanup-safe timer and AbortController helpers ---

export function setCleanupTimeout(fn: (...args: any[]) => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(fn, ms)
  registerCleanup(() => clearTimeout(id))
  return id
}

export function setCleanupInterval(fn: (...args: any[]) => void, ms: number): ReturnType<typeof setInterval> {
  const id = setInterval(fn, ms)
  registerCleanup(() => clearInterval(id))
  return id
}

export function createCleanupAbortController(): AbortController {
  const controller = new AbortController()
  registerCleanup(() => {
    try { controller.abort() } catch {}
  })
  return controller
}
