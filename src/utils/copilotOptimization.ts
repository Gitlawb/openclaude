import { isEnvTruthy } from './envUtils.js'
import { getAPIProvider } from './model/providers.js'

/**
 * GitHub Copilot Premium Request Optimization
 *
 * GitHub Copilot tracks "Premium Requests" per billing cycle. Each HTTP request
 * to api.githubcopilot.com counts toward this quota. OpenClaude's sub-agent
 * architecture can consume multiple Premium Requests per chat interaction
 * (one per agent per turn), rapidly depleting the quota.
 *
 * This module provides opt-out optimizations to reduce Premium Request usage.
 * In GitHub Copilot mode (CLAUDE_CODE_USE_GITHUB=1), optimization is enabled by
 * default with a max sub-agent concurrency of 1. To customize behavior:
 *
 *   GITHUB_COPILOT_MAX_SUBAGENTS=N       Max concurrent sub-agents (default: 1).
 *                                        Only 0 and 1 are enforced at runtime:
 *                                          0 → sub-agents are suppressed entirely
 *                                          1 → sub-agents run synchronously (one at a time)
 *                                        Values 2-10 are parsed and clamped but have
 *                                        no enforced effect — setting N=3 does NOT
 *                                        limit concurrency to 3; it behaves the same
 *                                        as N=1 (synchronous, one at a time).
 *                                        Set to 0 to disable sub-agents entirely
 *                                        (unless ALLOW_SUBAGENTS or
 *                                        FORCE_SYNC_SUBAGENTS is also set).
 *   GITHUB_COPILOT_ALLOW_SUBAGENTS=1     Re-enable background/parallel sub-agents
 *                                        even when MAX_SUBAGENTS is constrained.
 *   GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS=1 Force sub-agents to run synchronously
 *                                        instead of in background. Takes
 *                                        precedence over MAX_SUBAGENTS=0:
 *                                        sub-agents still run, one at a time.
 *   GITHUB_COPILOT_OPTIMIZATION_DISABLED=1 Turn off all Copilot optimizations.
 */

/** Max practical sub-agent concurrency. Values above this are clamped. */
const MAX_REASONABLE_SUBAGENTS = 10

export function isGitHubCopilotMode(): boolean {
  return getAPIProvider() === 'github'
}

export function isCopilotPremiumOptimizationEnabled(): boolean {
  if (!isGitHubCopilotMode()) return false
  return !isEnvTruthy(process.env.GITHUB_COPILOT_OPTIMIZATION_DISABLED)
}

/**
 * Returns the maximum allowed sub-agent concurrency in GitHub Copilot mode.
 *
 * @returns 0 when not in Copilot mode (no constraint).
 *          Clamped value when in Copilot mode (capped at MAX_REASONABLE_SUBAGENTS).
 *          Defaults to 1 when GITHUB_COPILOT_MAX_SUBAGENTS is unset or invalid.
 */
export function getCopilotMaxConcurrentSubagents(): number {
  if (!isGitHubCopilotMode()) return 0

  const raw = process.env.GITHUB_COPILOT_MAX_SUBAGENTS
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return Math.min(parsed, MAX_REASONABLE_SUBAGENTS)
    }
  }

  return 1
}

export function shouldSuppressSubagentsInCopilotMode(): boolean {
  if (!isCopilotPremiumOptimizationEnabled()) return false
  if (!isGitHubCopilotMode()) return false
  // Explicit opt-ins to run sub-agents take precedence over the
  // MAX_SUBAGENTS=0 suppression. ALLOW_SUBAGENTS re-enables async fan-out and
  // FORCE_SYNC asks for synchronous sub-agents — both mean "run sub-agents",
  // not "disable them". Without this, MAX_SUBAGENTS=0 + FORCE_SYNC=1 would
  // throw "Sub-agents are disabled" instead of running them one at a time.
  if (isEnvTruthy(process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS)) return false
  if (isEnvTruthy(process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS)) return false
  return getCopilotMaxConcurrentSubagents() === 0
}

export function shouldForceSyncSubagentsInCopilotMode(): boolean {
  if (!isCopilotPremiumOptimizationEnabled()) return false
  if (!isGitHubCopilotMode()) return false

  // Explicit force-sync flag always honored
  if (isEnvTruthy(process.env.GITHUB_COPILOT_FORCE_SYNC_SUBAGENTS)) return true

  // When ALLOW_SUBAGENTS is set, user explicitly opts into async sub-agents
  if (isEnvTruthy(process.env.GITHUB_COPILOT_ALLOW_SUBAGENTS)) return false

  // Enforce the concurrency cap: when max sub-agents > 0, run synchronously
  // so that at most one sub-agent executes at a time. When cap is 0, agents
  // are suppressed entirely via shouldSuppressSubagentsInCopilotMode().
  return getCopilotMaxConcurrentSubagents() > 0
}
