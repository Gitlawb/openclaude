/**
 * Doom loop detection: prevents wasting tokens on repeated identical tool calls.
 *
 * Tracks consecutive tool calls with the same (name, input) signature.
 * After a configurable threshold (default 3), blocks execution and tells the
 * model to change approach or ask the user.
 *
 * State is keyed per agent (main thread and each subagent track separately).
 * Subagents run runToolUse in the same process as the main loop, so a shared
 * counter would let three parallel agents each legitimately making the same
 * call once trip the block, and any interleaved call would reset it.
 */

const DEFAULT_THRESHOLD = 3

const MAIN_AGENT_KEY = 'main'

type ToolSignature = string

interface DoomLoopState {
  lastSignature: ToolSignature | null
  consecutiveCount: number
  blocked: boolean
}

const stateByAgent = new Map<string, DoomLoopState>()

function getState(agentKey: string): DoomLoopState {
  let state = stateByAgent.get(agentKey)
  if (!state) {
    state = { lastSignature: null, consecutiveCount: 0, blocked: false }
    stateByAgent.set(agentKey, state)
  }
  return state
}

function computeSignature(toolName: string, input: unknown): ToolSignature {
  // Use a stable JSON serialization for the input.
  // Truncate to avoid hashing huge inputs — first 2K chars is enough
  // to detect identical calls.
  const inputStr = typeof input === 'string'
    ? input
    : JSON.stringify(input) ?? ''
  return `${toolName}::${inputStr.slice(0, 2048)}`
}

/**
 * Record a tool call and check if it's a doom loop.
 * Returns `{ blocked: true }` if the tool should be blocked,
 * or `{ blocked: false }` to proceed normally.
 */
export function checkDoomLoop(
  toolName: string,
  input: unknown,
  options: { threshold?: number; agentKey?: string } = {},
): { blocked: boolean; count: number } {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const state = getState(options.agentKey ?? MAIN_AGENT_KEY)
  const sig = computeSignature(toolName, input)

  if (sig === state.lastSignature) {
    state.consecutiveCount++
  } else {
    state.lastSignature = sig
    state.consecutiveCount = 1
    state.blocked = false
  }

  if (state.consecutiveCount >= threshold && !state.blocked) {
    state.blocked = true
    return { blocked: true, count: state.consecutiveCount }
  }

  return { blocked: state.blocked, count: state.consecutiveCount }
}

/**
 * Reset doom loop state for one agent (e.g., at the start of its query turn).
 * Defaults to the main thread, matching checkDoomLoop's default key.
 */
export function resetDoomLoop(agentKey: string = MAIN_AGENT_KEY): void {
  stateByAgent.delete(agentKey)
}

/** Clear every agent's state. Test isolation only. */
export function resetAllDoomLoops(): void {
  stateByAgent.clear()
}

/**
 * Get current doom loop state for diagnostics.
 */
export function getDoomLoopState(
  agentKey: string = MAIN_AGENT_KEY,
): Readonly<DoomLoopState> {
  return { ...getState(agentKey) }
}
