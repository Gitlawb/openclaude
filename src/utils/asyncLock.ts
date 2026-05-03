/**
 * Simple async lock implementation to prevent race conditions
 */

type LockResolver = () => void

export class AsyncLock {
  private locked = false
  private queue: LockResolver[] = []

  /**
   * Acquire lock. Waits if lock is already held.
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }

    // Wait in queue
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  /**
   * Release lock. Allows next waiter to proceed.
   */
  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!
      resolve()
    } else {
      this.locked = false
    }
  }

  /**
   * Execute function with lock held
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
