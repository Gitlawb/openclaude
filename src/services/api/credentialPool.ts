/**
 * Credential pool with rotation for OpenAI-compatible providers.
 *
 * Lets users configure multiple API keys (comma-separated) and rotate through
 * them transparently when individual keys hit auth failures or rate limits.
 * Addresses heavy-use pain points: OpenRouter / Groq / Together free tiers,
 * personal + team key mixing, key-exhaustion on long runs.
 *
 * Usage pattern:
 *   const pool = createCredentialPool(keys)
 *   const attempt = pool.next()            // get current key + token
 *   // ... make request ...
 *   pool.markFailed(attempt.token, 'auth') // on 401: evict permanently
 *   pool.markFailed(attempt.token, 'rate_limit') // on 429: cooldown 30s
 *   pool.markSuccess(attempt.token)         // clear any prior cooldown
 *
 * Degradation: if every key is evicted or cooling down, `next()` still returns
 * the least-recently-failed key rather than nothing — caller's own error
 * handling takes over. Never hard-fails on pool exhaustion.
 */

type FailureKind = 'auth' | 'rate_limit'

export type CredentialAttempt = {
  token: string
  /** 0-based position in the original key list. Useful for logs. */
  index: number
}

export interface CredentialPool {
  /** Returns the next healthy key, or the best-degraded option if none are healthy. */
  next(): CredentialAttempt | null
  /** Records a failure. Auth → permanent evict. Rate limit → 30s cooldown. */
  markFailed(token: string, kind: FailureKind): void
  /** Clears any cooldown on a key that just succeeded. */
  markSuccess(token: string): void
  /** Total keys in the pool (including evicted). */
  readonly size: number
  /** Keys currently usable (not evicted, not cooling down). */
  healthyCount(): number
}

type KeyState = {
  token: string
  index: number
  evicted: boolean
  cooldownUntilMs: number
  lastFailureAtMs: number
}

const RATE_LIMIT_COOLDOWN_MS = 30_000

function nowMs(): number {
  return Date.now()
}

/**
 * Parse `OPENAI_API_KEYS` (plural, comma-separated) or `OPENAI_API_KEY` (single,
 * which may itself be a comma-separated list for convenience). Whitespace-trimmed,
 * empty entries dropped, duplicates collapsed.
 */
export function parseKeyList(
  raw: string | undefined | null,
): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function createCredentialPool(
  keys: readonly string[],
): CredentialPool {
  const states: KeyState[] = keys.map((token, index) => ({
    token,
    index,
    evicted: false,
    cooldownUntilMs: 0,
    lastFailureAtMs: 0,
  }))

  let cursor = 0

  function findByToken(token: string): KeyState | undefined {
    return states.find(s => s.token === token)
  }

  function isHealthy(state: KeyState, at: number): boolean {
    return !state.evicted && state.cooldownUntilMs <= at
  }

  function healthyCount(): number {
    const at = nowMs()
    return states.filter(s => isHealthy(s, at)).length
  }

  function next(): CredentialAttempt | null {
    if (states.length === 0) return null
    const at = nowMs()

    // Scan from cursor for a healthy key.
    for (let i = 0; i < states.length; i++) {
      const idx = (cursor + i) % states.length
      const state = states[idx]
      if (isHealthy(state, at)) {
        cursor = (idx + 1) % states.length
        return { token: state.token, index: state.index }
      }
    }

    // No healthy key. Pick the least-recently-failed non-evicted key as a
    // degraded attempt; if every key is evicted, return the least-recently-
    // failed evicted key so the caller still gets an error path rather than
    // a silent null.
    const nonEvicted = states.filter(s => !s.evicted)
    const pickFrom = nonEvicted.length > 0 ? nonEvicted : states
    const degraded = pickFrom.reduce((best, s) =>
      s.lastFailureAtMs < best.lastFailureAtMs ? s : best,
    )
    return { token: degraded.token, index: degraded.index }
  }

  function markFailed(token: string, kind: FailureKind): void {
    const state = findByToken(token)
    if (!state) return
    state.lastFailureAtMs = nowMs()
    if (kind === 'auth') {
      state.evicted = true
      return
    }
    state.cooldownUntilMs = nowMs() + RATE_LIMIT_COOLDOWN_MS
  }

  function markSuccess(token: string): void {
    const state = findByToken(token)
    if (!state) return
    state.cooldownUntilMs = 0
  }

  return {
    next,
    markFailed,
    markSuccess,
    get size() {
      return states.length
    },
    healthyCount,
  }
}
