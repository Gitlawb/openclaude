/**
 * Proactive mode stub for the open build.
 *
 * When KAIROS is enabled, 13+ files conditionally import this module via:
 *   const proactiveModule = feature('PROACTIVE') || feature('KAIROS')
 *     ? require('../../proactive/index.js') : null;
 *
 * All call sites use optional chaining (proactiveModule?.method()), so
 * returning safe "off" defaults is sufficient. A full implementation would
 * fire periodic <tick> prompts; this stub keeps the mode permanently off
 * while satisfying the API contract.
 */

type Unsubscribe = () => void

let _active = false
let _paused = false
const _subscribers = new Set<() => void>()

function notify(): void {
  for (const cb of _subscribers) {
    cb()
  }
}

export function isProactiveActive(): boolean {
  return _active
}

export function isProactivePaused(): boolean {
  return _paused
}

export function activateProactive(_source: string): void {
  if (_active) return
  _active = true
  notify()
}

export function deactivateProactive(): void {
  if (!_active) return
  _active = false
  _paused = false
  notify()
}

export function pauseProactive(): void {
  if (_paused) return
  _paused = true
  notify()
}

export function resumeProactive(): void {
  if (!_paused) return
  _paused = false
  notify()
}

export function setContextBlocked(_blocked: boolean): void {
  // No-op in stub — full implementation would gate tick scheduling
}

export function subscribeToProactiveChanges(callback: () => void): Unsubscribe {
  _subscribers.add(callback)
  return () => {
    _subscribers.delete(callback)
  }
}

export function getNextTickAt(): number | null {
  return null
}
