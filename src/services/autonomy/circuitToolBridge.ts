/**
 * Shared bridge: tool result messages → circuit breaker observations.
 * Used by toolOrchestration (serial path) and StreamingToolExecutor.
 */

import type { Message } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  createCircuitBreakerState,
  defaultCircuitConfig,
  observeToolResult,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
} from './circuitBreakers.js'

export function circuitBreakersEnabled(): boolean {
  // Env first — avoids loading settings/analytics graph in unit tests
  if (process.env.OPENCLAUDE_AUTONOMY === '0') return false
  if (isEnvTruthy(process.env.OPENCLAUDE_AUTONOMY)) return true
  try {
    // Lazy load settings only when env not set
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInitialSettings } = require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isAutonomyEnabled } = require('./routePolicy.js') as typeof import('./routePolicy.js')
    const settings = getInitialSettings()
    if (!isAutonomyEnabled(settings)) return false
    return settings.autonomy?.circuitBreakers !== false
  } catch {
    return false
  }
}

export function createToolCircuitSession(): {
  state: CircuitBreakerState
  config: CircuitBreakerConfig
} | null {
  if (!circuitBreakersEnabled()) return null
  return {
    state: createCircuitBreakerState(),
    config: defaultCircuitConfig(),
  }
}

export function extractToolObservation(
  message: Message | undefined,
  toolName: string,
): { toolName: string; error?: string; noopEdit?: boolean } | null {
  if (!message || message.type !== 'user') return null
  const content = message.message.content
  if (!Array.isArray(content)) return null
  let resultText = ''
  for (const block of content) {
    if (block.type !== 'tool_result') continue
    if (block.is_error) {
      const errText =
        typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
      return { toolName, error: errText }
    }
    if (typeof block.content === 'string') {
      resultText += block.content
    }
  }
  if (
    (toolName === 'Edit' ||
      toolName === 'Write' ||
      toolName === 'NotebookEdit') &&
    /no (?:changes|modifications)|did not change|unchanged/i.test(resultText)
  ) {
    return { toolName, noopEdit: true }
  }
  return { toolName }
}

/**
 * Observe a tool result message. Returns trip message string if circuit opened.
 */
export function observeToolMessage(
  session: { state: CircuitBreakerState; config: CircuitBreakerConfig },
  message: Message,
  toolName: string,
): string | null {
  const obs = extractToolObservation(message, toolName)
  if (!obs) return null
  const result = observeToolResult(session.state, obs, session.config)
  return result.tripped ? result.message : null
}
