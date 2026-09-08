const HEAP_SIZE_SUBSTRING = '--max-old-space-size'
const HEAP_SIZE_ENV = 'OPENCLAUDE_NODE_MAX_OLD_SPACE_SIZE_MB'
const DEFAULT_HEAP_SIZE_MB = '8192'

/**
 * Apply a numeric V8 old-space cap to `NODE_OPTIONS` for subprocesses.
 * Leaves an existing `--max-old-space-size` or
 * `--max-old-space-size-percentage` flag unchanged because both contain the
 * same substring. The current CLI process is already running; this only
 * preserves a cap for tools spawned after startup.
 */
export function applyChildProcessHeapOptions(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_OPTIONS?.includes(HEAP_SIZE_SUBSTRING)) return
  const existing = env.NODE_OPTIONS || ''
  const heapMb = env[HEAP_SIZE_ENV] || DEFAULT_HEAP_SIZE_MB
  env.NODE_OPTIONS = existing
    ? `${existing} --max-old-space-size=${heapMb}`
    : `--max-old-space-size=${heapMb}`
}
