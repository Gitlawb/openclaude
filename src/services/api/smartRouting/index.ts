import type { PermissionMode } from '../../../utils/permissions/PermissionMode.js'
import type { SettingsJson } from '../../../utils/settings/types.js'
import { isModelAllowed } from '../../../utils/model/modelAllowlist.js'
import { routeModel, type RoutingInput } from '../smartModelRouting.js'
import { resolveSmartRoutingConfig } from './resolveConfig.js'

export { readSmartRouting, type NormalizedSmartRouting } from './settings.js'
export { resolveSmartRoutingConfig } from './resolveConfig.js'

/**
 * Outcome of a per-turn routing decision.
 *
 * `routed: false` means the caller must use today's normal model resolution —
 * smart routing is disabled, misconfigured, disabled-for-session, or both roles
 * are outside the org allowlist. `justDisabledForSession` is set the first time
 * an allowlist conflict disables routing, so the caller emits one notice.
 */
export type TurnRoutingDecision =
  | { routed: false; justDisabledForSession?: boolean }
  | {
      routed: true
      model: string
      complexity: 'simple' | 'strong'
      reason: string
      /** The resolved strong model, for the routed-error fallback (U4). */
      strongModel: string
    }

// Session-scoped disable set. Keyed by session id so a disable never leaks into
// an unrelated session in a long-lived host (gRPC/SDK) — a new session has a new
// id and is therefore never in the set. NOT a process-global boolean.
const disabledSessions = new Set<string>()

/** Clear the session-disable flag (e.g. on explicit `/smartroute enable`). */
export function clearSmartRoutingSessionDisable(sessionId: string | undefined): void {
  if (sessionId) disabledSessions.delete(sessionId)
}

/** Whether smart routing has been auto-disabled for this session (allowlist conflict). */
export function isSmartRoutingDisabledForSession(sessionId: string | undefined): boolean {
  return sessionId ? disabledSessions.has(sessionId) : false
}

export interface DecideTurnModelInput {
  settings: SettingsJson | null
  parentModel: string
  permissionMode?: PermissionMode
  input: RoutingInput
  sessionId?: string
}

/**
 * Decide the model for this user turn: resolve config, classify via `routeModel`,
 * then enforce the org allowlist by calling `isModelAllowed` directly and
 * unconditionally (NOT the change-gated `shouldEnforceModelAllowlist`, which
 * short-circuits when the routed model equals the session model). A disallowed
 * routed model is coerced to strong; if strong is also disallowed, routing is
 * disabled for the session and the caller falls back to today's resolution.
 */
export function decideTurnModel({
  settings,
  parentModel,
  permissionMode,
  input,
  sessionId,
}: DecideTurnModelInput): TurnRoutingDecision {
  if (isSmartRoutingDisabledForSession(sessionId)) return { routed: false }

  const config = resolveSmartRoutingConfig({ settings, parentModel, permissionMode })
  if (!config.enabled) return { routed: false }

  const decision = routeModel(input, config)

  let model = decision.model
  let complexity = decision.complexity
  if (!isModelAllowed(model)) {
    // Coerce a disallowed model to strong.
    model = config.strongModel
    complexity = 'strong'
    if (!isModelAllowed(model)) {
      // Both roles outside the allowlist — disable for the session and let the
      // caller use today's (allowlist-clean) resolution. Notice fires once.
      const first = sessionId ? !disabledSessions.has(sessionId) : true
      if (sessionId) disabledSessions.add(sessionId)
      return { routed: false, justDisabledForSession: first }
    }
  }

  return { routed: true, model, complexity, reason: decision.reason, strongModel: config.strongModel }
}

/** Minimal message shape for turn counting — avoids importing heavy message types. */
interface TurnCountMessage {
  type: string
  isMeta?: boolean
  message?: { content?: unknown }
}

function isToolResultCarrier(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      block =>
        typeof block === 'object' && block !== null && (block as { type?: string }).type === 'tool_result',
    )
  )
}

function isRealUserMessage(m: TurnCountMessage): boolean {
  return m.type === 'user' && !m.isMeta && !isToolResultCarrier(m.message?.content)
}

/**
 * Count real user turns in the conversation: user-role messages that are neither
 * `isMeta` (injected nudges/system reminders) nor tool-result carriers
 * (continuation passes). This is the session-level turn number for
 * `RoutingInput.turnNumber` — distinct from the loop's per-`query()` `turnCount`.
 */
export function deriveUserTurnNumber(messages: readonly TurnCountMessage[]): number {
  let count = 0
  for (const m of messages) {
    if (isRealUserMessage(m)) count++
  }
  return count
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        block => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text',
      )
      .map(block => (block as { text?: string }).text ?? '')
      .join('\n')
  }
  return ''
}

/** Text of the most recent real user message (for `RoutingInput.userText`). */
export function extractLatestUserText(messages: readonly TurnCountMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (isRealUserMessage(m)) return textOfContent(m.message?.content)
  }
  return ''
}
