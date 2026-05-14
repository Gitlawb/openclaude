import { createAbortController } from './abortController.js'

/**
 * Creates a combined AbortSignal that aborts when the input signal aborts,
 * an optional second signal aborts, or an optional timeout elapses.
 * Returns both the signal and a cleanup function that removes event listeners
 * and clears the internal timeout timer.
 *
 * Use `timeoutMs` instead of passing `AbortSignal.timeout(ms)` as a signal —
 * under Bun, `AbortSignal.timeout` timers are finalized lazily and accumulate
 * in native memory until they fire (measured ~2.4KB/call held for the full
 * timeout duration). This implementation uses `setTimeout` + `clearTimeout`
 * so the timer is freed immediately on cleanup.
 */
export function createCombinedAbortSignal(
  signal: AbortSignal | undefined,
  opts?: { signalB?: AbortSignal; timeoutMs?: number },
): { signal: AbortSignal; cleanup: () => void } {
  const { signalB, timeoutMs } = opts ?? {}
  const combined = createAbortController()

  if (signal?.aborted) {
    combined.abort(signal.reason)
    return { signal: combined.signal, cleanup: () => {} }
  }
  if (signalB?.aborted) {
    combined.abort(signalB.reason)
    return { signal: combined.signal, cleanup: () => {} }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    signal?.removeEventListener('abort', abortFromSignal)
    signalB?.removeEventListener('abort', abortFromSignalB)
  }
  const abortCombined = (reason?: unknown) => {
    cleanup()
    combined.abort(reason)
  }
  const abortFromSignal = () => abortCombined(signal?.reason)
  const abortFromSignalB = () => abortCombined(signalB?.reason)
  const abortFromTimeout = () =>
    abortCombined(new DOMException('The operation timed out.', 'TimeoutError'))

  if (timeoutMs !== undefined) {
    timer = setTimeout(abortFromTimeout, timeoutMs)
    timer.unref?.()
  }
  signal?.addEventListener('abort', abortFromSignal)
  signalB?.addEventListener('abort', abortFromSignalB)

  return { signal: combined.signal, cleanup }
}
