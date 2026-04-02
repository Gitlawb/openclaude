type Listener = () => void

const listeners = new Set<Listener>()
let proactiveActive = false
let proactivePaused = false
let contextBlocked = false
let nextTickAt: number | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

export function isProactiveActive(): boolean {
  return proactiveActive
}

export function activateProactive(_source: string): void {
  proactiveActive = true
  proactivePaused = false
  nextTickAt = contextBlocked ? null : Date.now() + 60_000
  emit()
}

export function deactivateProactive(): void {
  proactiveActive = false
  proactivePaused = false
  nextTickAt = null
  emit()
}

export function isProactivePaused(): boolean {
  return proactivePaused || contextBlocked
}

export function pauseProactive(): void {
  proactivePaused = true
  nextTickAt = null
  emit()
}

export function setContextBlocked(blocked: boolean): void {
  contextBlocked = blocked
  if (blocked) {
    nextTickAt = null
  } else if (proactiveActive && !proactivePaused) {
    nextTickAt = Date.now() + 60_000
  }
  emit()
}

export function subscribeToProactiveChanges(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getNextTickAt(): number | null {
  return nextTickAt
}
