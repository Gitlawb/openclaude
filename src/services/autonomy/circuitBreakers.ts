/**
 * Circuit breakers for agent tool loops — stop spinning on repeated failures
 * or no-op edit streaks.
 */

export type CircuitBreakerConfig = {
  /** Same tool + same normalized error ≥ N → trip */
  maxSameToolErrors: number
  /** Consecutive edit tools with no file change ≥ N → trip */
  maxNoopEdits: number
  /** Optional hard cap on tool calls per turn */
  maxToolsPerTurn: number | null
}

export type ToolObservation = {
  toolName: string
  /** Normalized error message; empty/undefined means success */
  error?: string
  /** True when an edit/write tool reported zero net file change */
  noopEdit?: boolean
}

export type CircuitBreakerState = {
  sameErrorStreak: { toolName: string; error: string; count: number } | null
  noopEditStreak: number
  toolsThisTurn: number
}

export type CircuitTrip = {
  tripped: true
  code: 'same_tool_error' | 'noop_edits' | 'max_tools'
  message: string
}

export type CircuitOk = { tripped: false }

export type CircuitResult = CircuitTrip | CircuitOk

const EDIT_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'FileEdit',
  'FileWrite',
])

export function defaultCircuitConfig(): CircuitBreakerConfig {
  const maxToolsEnv = process.env.OPENCLAUDE_MAX_TOOLS_PER_TURN
  const parsed = maxToolsEnv ? parseInt(maxToolsEnv, 10) : NaN
  return {
    maxSameToolErrors: 3,
    maxNoopEdits: 2,
    maxToolsPerTurn: !isNaN(parsed) && parsed > 0 ? parsed : null,
  }
}

export function createCircuitBreakerState(): CircuitBreakerState {
  return {
    sameErrorStreak: null,
    noopEditStreak: 0,
    toolsThisTurn: 0,
  }
}

function normalizeError(error: string): string {
  return error
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['"`]/g, '')
    .trim()
    .slice(0, 160)
}

/**
 * Observe one tool result and return whether the circuit should trip.
 * Mutates state in place.
 */
export function observeToolResult(
  state: CircuitBreakerState,
  observation: ToolObservation,
  config: CircuitBreakerConfig = defaultCircuitConfig(),
): CircuitResult {
  state.toolsThisTurn++

  if (
    config.maxToolsPerTurn !== null &&
    state.toolsThisTurn > config.maxToolsPerTurn
  ) {
    return {
      tripped: true,
      code: 'max_tools',
      message: `Circuit breaker: exceeded max tools per turn (${config.maxToolsPerTurn}). Stopping to avoid runaway loops.`,
    }
  }

  if (observation.error) {
    const norm = normalizeError(observation.error)
    if (
      state.sameErrorStreak &&
      state.sameErrorStreak.toolName === observation.toolName &&
      state.sameErrorStreak.error === norm
    ) {
      state.sameErrorStreak.count++
    } else {
      state.sameErrorStreak = {
        toolName: observation.toolName,
        error: norm,
        count: 1,
      }
    }
    state.noopEditStreak = 0

    if (state.sameErrorStreak.count >= config.maxSameToolErrors) {
      return {
        tripped: true,
        code: 'same_tool_error',
        message: `Circuit breaker: tool "${observation.toolName}" failed ${state.sameErrorStreak.count} times with the same error. Stop and reassess instead of retrying blindly.`,
      }
    }
    return { tripped: false }
  }

  // Success path — reset same-error streak
  state.sameErrorStreak = null

  if (EDIT_TOOLS.has(observation.toolName) && observation.noopEdit) {
    state.noopEditStreak++
    if (state.noopEditStreak >= config.maxNoopEdits) {
      return {
        tripped: true,
        code: 'noop_edits',
        message: `Circuit breaker: ${state.noopEditStreak} consecutive edit tools with no file change. Stopping to avoid empty edit loops.`,
      }
    }
  } else if (EDIT_TOOLS.has(observation.toolName)) {
    state.noopEditStreak = 0
  }

  return { tripped: false }
}

export function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name)
}
