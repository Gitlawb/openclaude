type ProactiveListener = () => void

const listeners = new Set<ProactiveListener>()

let proactiveActive = false
let proactivePaused = false
let contextBlocked = false
let nextTickAt: number | null = null

function notifyProactiveListeners(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('proactive listener error', error)
      // Listener failures must not prevent state transitions or later listeners.
    }
  }
}

export function subscribeToProactiveChanges(
  listener: ProactiveListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isProactiveActive(): boolean {
  return proactiveActive
}

export function isProactivePaused(): boolean {
  return proactivePaused || contextBlocked
}

export function getNextTickAt(): number | null {
  return isProactivePaused() ? null : nextTickAt
}

export function activateProactive(_source?: string): void {
  proactiveActive = true
  proactivePaused = false
  contextBlocked = false
  nextTickAt = null
  notifyProactiveListeners()
}

export function deactivateProactive(): void {
  proactiveActive = false
  proactivePaused = false
  contextBlocked = false
  nextTickAt = null
  notifyProactiveListeners()
}

export function pauseProactive(): void {
  proactivePaused = true
  notifyProactiveListeners()
}

export function resumeProactive(): void {
  if (!proactiveActive) {
    return
  }
  proactivePaused = false
  notifyProactiveListeners()
}

export function setContextBlocked(blocked: boolean): void {
  contextBlocked = blocked
  if (blocked) {
    nextTickAt = null
  }
  notifyProactiveListeners()
}
