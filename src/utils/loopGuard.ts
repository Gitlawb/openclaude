/**
 * Loop protection utilities to prevent infinite loops in parsers
 */

export class LoopIterationError extends Error {
  constructor(message: string, public iterations: number) {
    super(message)
    this.name = 'LoopIterationError'
  }
}

/**
 * Creates a loop guard that throws after max iterations
 * @param maxIterations Maximum allowed iterations (default: 100,000)
 * @param context Optional context for error message
 * @returns Function to call on each iteration
 */
export function createLoopGuard(
  maxIterations = 100_000,
  context?: string,
): () => void {
  let iterations = 0
  return () => {
    if (++iterations > maxIterations) {
      const msg = context
        ? `Loop iteration limit exceeded in ${context}: ${iterations} iterations`
        : `Loop iteration limit exceeded: ${iterations} iterations`
      throw new LoopIterationError(msg, iterations)
    }
  }
}

/**
 * Wraps a while(true) loop with iteration protection
 * @param fn Loop body function that returns true to continue, false to break
 * @param maxIterations Maximum allowed iterations
 * @param context Optional context for error message
 */
export function safeWhileLoop(
  fn: () => boolean,
  maxIterations = 100_000,
  context?: string,
): void {
  const guard = createLoopGuard(maxIterations, context)
  while (true) {
    guard()
    if (!fn()) break
  }
}
