import { feature } from 'bun:bundle'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getSdkBetas } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { partitionContext } from '../../utils/contextPartitioning.js'
import { pruneByRelevance } from '../../utils/relevancePruning.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getMaxOutputTokensForModel } from '../api/claude.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
  type RecompactionInfo,
} from './compact.js'
import {
  clearBreakerTrippedState,
  recordBreakerTripped,
} from './compactWarningState.js'
import {
  isMainThreadCompact,
  runPostCompactCleanup,
} from './postCompactCleanup.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'

// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  const autoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  // Floor: effective context must be at least the summary reservation plus a
  // usable buffer. If it goes lower, the auto-compact threshold becomes
  // negative and fires on every message (issue #635).
  const autocompactBuffer = 13_000 // must match AUTOCOMPACT_BUFFER_TOKENS
  const effectiveContext = contextWindow - reservedTokensForSummary
  return Math.max(effectiveContext, reservedTokensForSummary + autocompactBuffer)
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  // Unique ID per turn
  turnId: string
  // Consecutive autocompact failures. Reset on success.
  // Used by the cooldown circuit breaker to avoid retry storms when the
  // context is irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number
  // Process-local retry timestamp for the cooldown breaker. This state is
  // threaded through query() callers rather than serialized into transcripts.
  nextRetryAtMs?: number
  lastFailureAtMs?: number
  // When set, bypasses shouldAutoCompact() token threshold check.
  // Memory pressure and hard message-count are safety guards that also bypass
  // user opt-outs; user message-count still respects auto-compact settings.
  forceReason?: 'memory-pressure' | 'hard-message-count' | 'user-message-count'
  // Wall-clock time of the most recent failure from a forced compaction
  // (memory-pressure or message-count). Distinct from `lastFailureAtMs`,
  // which records every compaction failure regardless of source. Issue
  // #1373 follow-up: a forced message-count attempt that fails can
  // otherwise re-fire on every over-cap turn because the query loop
  // re-sets `forceReason` before the breaker cool-down has elapsed.
  // The cap check uses this together with the breaker cool-down to gate
  // the re-trigger without giving up the safety-net guarantee: token-
  // threshold trips (no `forceReason`) still bypass as today.
  lastForcedFailureAtMs?: number
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

export const AUTOCOMPACT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000

// Pause autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

/**
 * Hard safety-net cap on the active message count. Independent of the
 * token-based auto-compact threshold, which the circuit breaker can stall.
 *
 * When the conversation exceeds this many messages, the query loop sets
 * `forceReason: 'hard-message-count'` on the autoCompactTracking state, which
 * forces an immediate compaction attempt even while the breaker is in
 * cooldown. Issue #1373: without this, a single summarization failure that
 * trips the breaker can let `state.messages` grow without bound until the
 * Node heap OOMs.
 *
 * The default (1000) is generous — a normal session is well under 200
 * messages — so this only fires for runaway growth from a stalled breaker
 * or wedged token accounting. Overridable per-deployment via
 * `OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP`. Set to `0` to disable (not
 * recommended in production).
 *
 * This is a runtime safety net, NOT a user setting. The forced message-count
 * path bypasses `isAutoCompactEnabled()` — `DISABLE_COMPACT`,
 * `DISABLE_AUTO_COMPACT`, and `autoCompactEnabled: false` in user config do
 * NOT disable the hard cap. The only opt-out is the `=0` env value above.
 * (For a per-user opt-in cap that DOES respect the user's auto-compact
 * settings, see `OPENCLAUDE_MAX_ACTIVE_MESSAGES` /
 * `maxMessagesCompactionThreshold`.)
 */
export const MAX_ACTIVE_MESSAGES_HARD_CAP = 1000

export function getAutoCompactFailureCooldownMs(): number {
  const override = process.env.OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS
  if (override) {
    const trimmed = override.trim()
    const parsed = Number(trimmed)
    if (/^[1-9]\d*$/.test(trimmed) && Number.isSafeInteger(parsed)) {
      return parsed
    }
  }
  return AUTOCOMPACT_FAILURE_COOLDOWN_MS
}

/**
 * Resolve the hard cap. Reads `OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP` if set
 * to a positive integer; otherwise returns `MAX_ACTIVE_MESSAGES_HARD_CAP`.
 * `0` is treated as "disabled" (off). Non-numeric or negative values fall
 * back to the constant. The strict-integer regex matches the pattern used by
 * `getAutoCompactFailureCooldownMs` so the two env-var overrides behave
 * consistently.
 */
export function getMaxActiveMessagesHardCap(): number {
  const override = process.env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP
  if (override) {
    const trimmed = override.trim()
    const parsed = Number(trimmed)
    if (/^\d+$/.test(trimmed) && Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return MAX_ACTIVE_MESSAGES_HARD_CAP
}

export function resolveAutoCompactCircuitBreakerState(args: {
  tracking?: Pick<
    AutoCompactTrackingState,
    'consecutiveFailures' | 'nextRetryAtMs' | 'lastFailureAtMs'
  >
  nowMs: number
  cooldownMs: number
}):
  | {
      action: 'allow'
      effectiveConsecutiveFailures: number
      wasHalfOpen: boolean
    }
  | {
      action: 'skip'
      consecutiveFailures: number
      nextRetryAtMs: number
      circuitBreakerActive: true
    } {
  const { tracking, nowMs, cooldownMs } = args
  const consecutiveFailures = Math.max(0, tracking?.consecutiveFailures ?? 0)
  if (consecutiveFailures < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return {
      action: 'allow',
      effectiveConsecutiveFailures: consecutiveFailures,
      wasHalfOpen: false,
    }
  }

  let nextRetryAtMs = tracking?.nextRetryAtMs
  if (
    (typeof nextRetryAtMs !== 'number' ||
      !Number.isFinite(nextRetryAtMs)) &&
    typeof tracking?.lastFailureAtMs === 'number' &&
    Number.isFinite(tracking.lastFailureAtMs) &&
    Number.isFinite(cooldownMs)
  ) {
    nextRetryAtMs = tracking.lastFailureAtMs + cooldownMs
  }
  if (
    typeof nextRetryAtMs === 'number' &&
    Number.isFinite(nextRetryAtMs) &&
    nowMs < nextRetryAtMs
  ) {
    return {
      action: 'skip',
      consecutiveFailures,
      nextRetryAtMs,
      circuitBreakerActive: true,
    }
  }

  return {
    action: 'allow',
    effectiveConsecutiveFailures:
      MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES - 1,
    wasHalfOpen: true,
  }
}

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)

  const autocompactThreshold =
    effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS

  // Override for easier testing of autocompact
  const envPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }

  return autocompactThreshold
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

  // Use the raw context window (without output reservation) for the percentage
  // display, so users see remaining context relative to the model's full capacity.
  // The threshold (which subtracts buffer) should only affect when we warn/compact,
  // not what percentage we display.
  const rawContextWindow = getContextWindowForModel(model, getSdkBetas())
  const percentLeft = Math.max(
    0,
    Math.round(((rawContextWindow - tokenUsage) / rawContextWindow) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  // Allow override for testing
  const blockingLimitOverride = process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = getGlobalConfig()
  return userConfig.autoCompactEnabled
}

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
  // When set, the query loop has stamped a `forceReason` on tracking and
  // routed the call through here. All forced reasons bypass the token-threshold
  // check. Only runtime safety nets (`memory-pressure`, `hard-message-count`)
  // bypass the `isAutoCompactEnabled()` user-opt-out guard (DISABLE_COMPACT,
  // DISABLE_AUTO_COMPACT, autoCompactEnabled=false). The user-configured
  // message cap is an auto-compact trigger, so it must still respect those
  // opt-outs. Other guards (recursion in forked agents, REACTIVE_COMPACT,
  // CONTEXT_COLLAPSE) still apply — those are real safety constraints.
  forceReason?: AutoCompactTrackingState['forceReason'],
): Promise<boolean> {
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
  // marble_origami is the ctx-agent — if ITS context blows up and
  // autocompact fires, runPostCompactCleanup calls resetContextCollapse()
  // which destroys the MAIN thread's committed log (module-level state
  // shared across forks). Inside feature() so the string DCEs from
  // external builds (it's in excluded-strings.txt).
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return false
    }
  }

  const bypassUserOptOuts =
    forceReason === 'memory-pressure' || forceReason === 'hard-message-count'

  // Safety-net forced calls bypass `isAutoCompactEnabled()` — see the param doc.
  if (!bypassUserOptOuts && !isAutoCompactEnabled()) {
    return false
  }

  // Reactive-only mode: suppress proactive autocompact, let reactive compact
  // catch the API's prompt-too-long. feature() wrapper keeps the flag string
  // out of external builds (REACTIVE_COMPACT is internal-only).
  // Note: returning false here also means autoCompactIfNeeded never reaches
  // trySessionMemoryCompaction in the query loop — the /compact call site
  // still tries session memory first. Revisit if reactive-only graduates.
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }

  // Context-collapse mode: same suppression. Collapse IS the context
  // management system when it's on — the 90% commit / 95% blocking-spawn
  // flow owns the headroom problem. Autocompact firing at effective-13k
  // (~93% of effective) sits right between collapse's commit-start (90%)
  // and blocking (95%), so it would race collapse and usually win, nuking
  // granular context that collapse was about to save. Gating here rather
  // than in isAutoCompactEnabled() keeps reactiveCompact alive as the 413
  // fallback (it consults isAutoCompactEnabled directly) and leaves
  // sessionMemory + manual /compact working.
  //
  // Consult isContextCollapseEnabled (not the raw gate) so the
  // CLAUDE_CONTEXT_COLLAPSE env override is honored here too. require()
  // inside the block breaks the init-time cycle (this file exports
  // getEffectiveContextWindowSize which collapse's index imports).
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      return false
    }
  }

  if (forceReason) {
    logForDebugging(
      `autocompact: skipping token threshold check (forced: ${forceReason})`,
    )
    return true
  }

  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)

  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}`,
  )

  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
  )

  return isAboveAutoCompactThreshold
}

export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
  nextRetryAtMs?: number
  lastFailureAtMs?: number
  circuitBreakerActive?: boolean
  circuitBreakerTripped?: boolean
  // Set on a forced-attempt failure (memory-pressure or message-count);
  // undefined for non-forced failures and on success. See the type-level
  // note on `AutoCompactTrackingState.lastForcedFailureAtMs`.
  lastForcedFailureAtMs?: number
}> {
  // Force compaction if a pressure/count signal set forceReason.
  // Consume the flag so it only forces one compaction cycle.
  // Resolve `forcedBy` before the `DISABLE_COMPACT` early-return so the
  // safety-net forced path bypasses BOTH that env var AND
  // `isAutoCompactEnabled()` (issue #1373 follow-up, CodeRabbit). The hard cap
  // and memory pressure are runtime safety nets, not user settings — the only
  // documented opt-out for the hard cap is
  // `OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP=0`, and a user who flipped
  // `DISABLE_COMPACT` did not opt out of the OOM guard. The user-configured
  // message-count threshold is not a safety net, so it still respects opt-outs.
  // The other guards (recursion, REACTIVE_COMPACT, CONTEXT_COLLAPSE) still
  // apply — they are safety constraints, not opt-outs.
  const forcedBy = tracking?.forceReason
  const bypassUserOptOuts =
    forcedBy === 'memory-pressure' || forcedBy === 'hard-message-count'
  if (tracking?.forceReason) {
    tracking.forceReason = undefined
  }
  // Safety-net forced calls bypass the DISABLE_COMPACT early-return (see
  // above). Non-safety calls still honor it, matching the long-standing
  // behavior for manual /compact, token-threshold auto-compact, and the
  // user-configured message-count threshold.
  if (!bypassUserOptOuts && isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  // Forward the resolved `forceReason` to shouldAutoCompact so all forced
  // reasons skip the token threshold, while only safety-net reasons bypass
  // user opt-outs. The other guards (recursion, REACTIVE_COMPACT,
  // CONTEXT_COLLAPSE) still apply — they are safety constraints, not opt-outs.
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
    forcedBy,
  )

  if (!shouldCompact) {
    if ((tracking?.consecutiveFailures ?? 0) > 0 || tracking?.nextRetryAtMs) {
      return {
        wasCompacted: false,
        consecutiveFailures: 0,
        circuitBreakerActive: false,
        circuitBreakerTripped: false,
      }
    }
    return { wasCompacted: false }
  }

  const now = Date.now()
  const cooldownMs = getAutoCompactFailureCooldownMs()

  // Forced compactions (memory-pressure, message-count, or session-resume
  // overrides) bypass the cool-down skip. The breaker's job is to avoid
  // retry storms on token-threshold-driven compactions; an explicit force
  // signal says "we know this is risky, do it anyway" — and without honoring
  // it, a tripped breaker can let state.messages grow without bound until
  // the Node heap OOMs (issue #1373).
  //
  // We still count the attempt against `consecutiveFailures` and update
  // `nextRetryAtMs` on failure, so a half-open failure re-trips instead of
  // silently retrying every turn.
  const isForced = forcedBy !== undefined

  const breakerState = resolveAutoCompactCircuitBreakerState({
    tracking,
    nowMs: now,
    cooldownMs,
  })

  if (breakerState.action === 'skip' && !isForced) {
    return {
      wasCompacted: false,
      consecutiveFailures: breakerState.consecutiveFailures,
      nextRetryAtMs: breakerState.nextRetryAtMs,
      circuitBreakerActive: true,
      circuitBreakerTripped: false,
    }
  }

  // After the early-return above, breakerState must be the 'allow' branch
  // (which carries `wasHalfOpen` and `effectiveConsecutiveFailures`). Forced
  // compactions go through this branch too — they share the same shape even
  // though we don't apply the half-open counter reset for them.
  const allowState = breakerState.action === 'allow' ? breakerState : null
  const wasHalfOpen = allowState?.wasHalfOpen === true
  const effectiveConsecutiveFailures =
    allowState?.effectiveConsecutiveFailures ??
    Math.max(0, tracking?.consecutiveFailures ?? 0)

  const effectiveTracking: AutoCompactTrackingState | undefined =
    tracking && wasHalfOpen && !isForced
      ? {
          ...tracking,
          consecutiveFailures: effectiveConsecutiveFailures,
          nextRetryAtMs: undefined,
        }
      : tracking

  const contextWindow = getContextWindowForModel(model, getSdkBetas())

  const partitioned = partitionContext(messages, {
    contextWindow,
    recentCount: 5,
  })
  const availableSpace = partitioned.canFitInWindow
    ? contextWindow - partitioned.totalTokens
    : Math.floor(contextWindow * 0.1)

  if (!partitioned.canFitInWindow && availableSpace > 1000) {
    // Preserve system messages
    const systemMessages = messages.filter(m => m.message?.role === 'system')
    const nonSystemMessages = messages.filter(m => m.message?.role !== 'system')
    
    const pruned = pruneByRelevance(nonSystemMessages, {
      targetTokens: availableSpace,
      preserveRecent: 3,
      preserveTools: true,
      preserveErrors: true,
    })
    
    // Combine preserved system + pruned
    const finalMessages = [...systemMessages, ...pruned]
    
    if (finalMessages.length > 0 && finalMessages.length < messages.length) {
      logForDebugging(
        `partition+prune: ${messages.length} -> ${finalMessages.length} messages`,
      )
      messages = finalMessages
    }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: effectiveTracking?.compacted === true,
    turnsSincePreviousCompact: effectiveTracking?.turnCounter ?? -1,
    previousCompactTurnId: effectiveTracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

  // EXPERIMENT: Try session memory compaction first
  const sessionMemoryResult = await trySessionMemoryCompaction(
    messages,
    toolUseContext.agentId,
    recompactionInfo.autoCompactThreshold,
  )
  if (sessionMemoryResult) {
    // Reset lastSummarizedMessageId since session memory compaction prunes messages
    // and the old message UUID will no longer exist after the REPL replaces messages
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    // Issue #1373: reset the session-level breaker-trip state on a
    // successful session-memory compaction. The state must be cleared
    // by every successful-compaction call site (auto session-memory,
    // auto traditional, manual /compact session-memory, manual
    // /compact traditional). It cannot live in `runPostCompactCleanup`
    // because that helper is also called from `clearSessionCaches`
    // on resume/continue, which is not a compaction event — clearing
    // there would silently reset recovery state without a real
    // compaction succeeding. Microcompact intentionally does not
    // call this.
    //
    // Subagent guard: `breakerTripStore` is module-level, and
    // subagents (agent:*) share the process with the main thread.
    // A subagent's success must not clear the main session's
    // "auto-compact paused" signal — the recovery is per-session,
    // not per-compaction. Reuse the same predicate as
    // `runPostCompactCleanup` so the two stay in sync.
    if (isMainThreadCompact(querySource)) {
      clearBreakerTrippedState()
    }
    // Reset cache read baseline so the post-compact drop isn't flagged as a
    // break. compactConversation does this internally; SM-compact doesn't.
    // BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break events
    // false positives (systemPromptChanged=true, timeSinceLastAssistantMsg=-1).
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
    }
    markPostCompaction()
    return {
      wasCompacted: true,
      compactionResult: sessionMemoryResult,
      consecutiveFailures: 0,
    }
  }

  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions for autocompact
      undefined, // No custom instructions for autocompact
      true, // isAutoCompact
      recompactionInfo,
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    // Issue #1373: reset the session-level breaker-trip state on a
    // successful traditional compaction. See the session-memory
    // success path above for the full rationale; the same funnel
    // constraint applies — `runPostCompactCleanup` is also called
    // from `clearSessionCaches` on resume/continue, so the reset
    // must live at successful-compaction call sites, not in the
    // shared helper.
    //
    // Subagent guard: same as above — `breakerTripStore` is
    // module-level and shared with the main thread.
    if (isMainThreadCompact(querySource)) {
      clearBreakerTrippedState()
    }

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
    }
  } catch (error) {
    const wasUserAbort = hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)
    if (wasUserAbort) {
      return {
        wasCompacted: false,
        consecutiveFailures: effectiveConsecutiveFailures,
        nextRetryAtMs: wasHalfOpen ? undefined : tracking?.nextRetryAtMs,
        circuitBreakerActive: false,
        circuitBreakerTripped: false,
      }
    }

    logError(error)
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts until cooldown.
    const nextFailures = Math.min(
      effectiveConsecutiveFailures + 1,
      MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
    )
    const circuitBreakerTripped =
      nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
    const failureAtMs = Date.now()
    const nextRetryAtMs = circuitBreakerTripped
      ? failureAtMs + cooldownMs
      : undefined
    if (circuitBreakerTripped) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures — retrying after cooldown`,
        { level: 'warn' },
      )
      // Surface the trip to the breaker-trip store (issue #1373). The REPL
      // and SDK can read this to show "auto-compact paused, retrying in N
      // minutes" instead of failing silently while state.messages grows.
      //
      // Subagent guard: a subagent failure must not mark the main
      // session's breaker as tripped — the recovery signal is
      // per-session, and a subagent's compactConversation failure is
      // not the main session's failure. `breakerTripStore` is
      // module-level, so without this guard a wedged subagent would
      // make the main session look paused for 5 minutes.
      if (isMainThreadCompact(querySource)) {
        recordBreakerTripped({
          failureCount: nextFailures,
          trippedAtMs: failureAtMs,
        })
      }
    }
    return {
      wasCompacted: false,
      consecutiveFailures: nextFailures,
      nextRetryAtMs,
      lastFailureAtMs: failureAtMs,
      circuitBreakerActive: circuitBreakerTripped,
      circuitBreakerTripped,
      // Only forced attempts write this so the cap-check gate can tell
      // a token-threshold trip (no forced attempt yet) apart from a
      // recent forced-attempt failure. See
      // `AutoCompactTrackingState.lastForcedFailureAtMs`.
      lastForcedFailureAtMs: isForced ? failureAtMs : undefined,
    }
  }
}
