interface SessionEntry {
  messages: unknown[]
  lastAccess: number
}

const MAX_SESSIONS = 1000
const SESSION_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

export class SessionStore {
  private store = new Map<string, SessionEntry>()
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor() {
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000)
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  get(sessionId: string): unknown[] | undefined {
    const entry = this.store.get(sessionId)
    if (!entry) return undefined
    if (Date.now() - entry.lastAccess > SESSION_TTL_MS) {
      this.store.delete(sessionId)
      return undefined
    }
    entry.lastAccess = Date.now()
    return entry.messages
  }

  set(sessionId: string, messages: unknown[]): void {
    if (this.store.size >= MAX_SESSIONS && !this.store.has(sessionId)) {
      this.evictOldest()
    }
    this.store.set(sessionId, { messages, lastAccess: Date.now() })
  }

  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined
  }

  get size(): number {
    return this.store.size
  }

  private evictExpired(): void {
    const now = Date.now()
    for (const [id, entry] of this.store) {
      if (now - entry.lastAccess > SESSION_TTL_MS) {
        this.store.delete(id)
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null
    let oldestTime = Infinity
    for (const [id, entry] of this.store) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestId = id
      }
    }
    if (oldestId) this.store.delete(oldestId)
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
    this.store.clear()
  }
}
