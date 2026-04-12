/**
 * Periodic background summarization for coordinator mode sub-agents.
 *
 * Forks the sub-agent's conversation every ~30s using runForkedAgent()
 * to generate a 1-2 sentence progress summary. The summary is stored
 * on AgentProgress for UI display.
 *
 * Cache sharing: uses the same CacheSafeParams as the parent agent
 * to share the prompt cache. Tools are kept in the request for cache
 * key matching but denied via canUseTool callback.
 */

import type { TaskContext } from '../../Task.js'
import { updateAgentSummary } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { filterIncompleteToolCalls } from '../../tools/AgentTool/runAgent.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import { getAgentTranscript } from '../../utils/sessionStorage.js'

const SUMMARY_INTERVAL_MS = 30_000
const MIN_SUMMARY_INTERVAL_MS = 5_000
const MAX_CONSECUTIVE_FAILURES = 5
const SUMMARY_TIMEOUT_MS = 10_000
const MIN_MESSAGE_COUNT = 3

function buildSummaryPrompt(previousSummary: string | null): string {
  const prevLine = previousSummary
    ? `\nPrevious: "${previousSummary}" — say something NEW.\n`
    : ''

  return `Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.
${prevLine}
Good: "Reading runAgent.ts"
Good: "Fixing null check in validate.ts"
Good: "Running auth module tests"
Good: "Adding retry logic to fetchUser"

Bad (past tense): "Analyzed the branch diff"
Bad (too vague): "Investigating the issue"
Bad (too long): "Reviewing full branch diff and AgentTool.tsx integration"
Bad (branch name): "Analyzed adam/background-summary branch diff"`
}

export interface AgentSummaryConfig {
  /** Interval between summaries in ms (default: 30s) */
  intervalMs?: number
  /** Minimum messages required before first summary (default: 3) */
  minMessageCount?: number
  /** Timeout for summary generation in ms (default: 10s) */
  timeoutMs?: number
}

export function startAgentSummarization(
  taskId: string,
  agentId: AgentId,
  cacheSafeParams: CacheSafeParams,
  setAppState: TaskContext['setAppState'],
  config?: AgentSummaryConfig,
): { stop: () => void } {
  // Drop forkContextMessages from the closure — runSummary rebuilds it each
  // tick from getAgentTranscript(). Without this, the original fork messages
  // (passed from AgentTool.tsx) are pinned for the lifetime of the timer.
  const { forkContextMessages: _drop, ...baseParams } = cacheSafeParams
  let summaryAbortController: AbortController | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let previousSummary: string | null = null
  let consecutiveFailures = 0

  const intervalMs = Math.max(
    config?.intervalMs ?? SUMMARY_INTERVAL_MS,
    MIN_SUMMARY_INTERVAL_MS,
  )
  const minMessageCount = config?.minMessageCount ?? MIN_MESSAGE_COUNT
  const timeoutMs = config?.timeoutMs ?? SUMMARY_TIMEOUT_MS

  async function runSummary(): Promise<void> {
    if (stopped) return

    // Backoff check: pause summarization after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logForDebugging(
        `[AgentSummary] Pausing for ${taskId} after ${consecutiveFailures} consecutive failures`,
      )
      return
    }

    logForDebugging(`[AgentSummary] Timer fired for agent ${agentId}`)

    try {
      // Read current messages from transcript
      const transcript = await getAgentTranscript(agentId)
      if (!transcript || transcript.messages.length < minMessageCount) {
        // Not enough context yet — finally block will schedule next attempt
        logForDebugging(
          `[AgentSummary] Skipping summary for ${taskId}: not enough messages (${transcript?.messages.length ?? 0} < ${minMessageCount})`,
        )
        return
      }

      // Filter to clean message state
      const cleanMessages = filterIncompleteToolCalls(transcript.messages)

      // Build fork params with current messages
      const forkParams: CacheSafeParams = {
        ...baseParams,
        forkContextMessages: cleanMessages,
      }

      logForDebugging(
        `[AgentSummary] Forking for summary, ${cleanMessages.length} messages in context`,
      )

      // Create abort controller for this summary with timeout
      summaryAbortController = new AbortController()
      const timeoutId = setTimeout(() => {
        summaryAbortController?.abort()
      }, timeoutMs)

      // Deny tools via callback, NOT by passing tools:[] - that busts cache
      const canUseTool = async () => ({
        behavior: 'deny' as const,
        message: 'No tools needed for summary',
        decisionReason: { type: 'other' as const, reason: 'summary only' },
      })

      // DO NOT set maxOutputTokens here. The fork piggybacks on the main
      // thread's prompt cache by sending identical cache-key params (system,
      // tools, model, messages prefix, thinking config). Setting maxOutputTokens
      // would clamp budget_tokens, creating a thinking config mismatch that
      // invalidates the cache.
      //
      // ContentReplacementState is cloned by default in createSubagentContext
      // from forkParams.toolUseContext (the subagent's LIVE state captured at
      // onCacheSafeParams time). No explicit override needed.
      const result = await runForkedAgent({
        promptMessages: [
          createUserMessage({ content: buildSummaryPrompt(previousSummary) }),
        ],
        cacheSafeParams: forkParams,
        canUseTool,
        querySource: 'agent_summary',
        forkLabel: 'agent_summary',
        overrides: { abortController: summaryAbortController },
        skipTranscript: true,
      })

      clearTimeout(timeoutId)

      if (stopped) return

      // Extract summary text from result
      let summaryText: string | null = null
      for (const msg of result.messages) {
        if (msg.type !== 'assistant') continue
        // Skip API error messages
        if (msg.isApiErrorMessage) {
          logForDebugging(
            `[AgentSummary] Skipping API error message for ${taskId}`,
          )
          continue
        }
        const textBlock = msg.message.content.find((b: { type: string }) => b.type === 'text')
        if (textBlock?.type === 'text' && textBlock.text.trim()) {
          summaryText = textBlock.text.trim()
          break
        }
      }

      // Validate and deduplicate summary
      if (!summaryText) {
        logForDebugging(`[AgentSummary] Empty summary for ${taskId}, skipping`)
        return
      }

      if (summaryText === previousSummary) {
        logForDebugging(
          `[AgentSummary] Duplicate summary for ${taskId}, skipping update`,
        )
        return
      }

      logForDebugging(
        `[AgentSummary] Summary result for ${taskId}: ${summaryText}`,
      )
      previousSummary = summaryText
      consecutiveFailures = 0 // Reset failure count on success
      updateAgentSummary(taskId, summaryText, setAppState)
    } catch (e) {
      if (!stopped && e instanceof Error) {
        logError(e)
        consecutiveFailures++
        logForDebugging(
          `[AgentSummary] Failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} for ${taskId}: ${e.message}`,
        )
      }
    } finally {
      summaryAbortController = null
      // Reset timer on completion (not initiation) to prevent overlapping summaries
      if (!stopped) {
        scheduleNext()
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    // Use longer interval if we're in backoff mode
    const actualInterval =
      consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
        ? intervalMs * 2 // Double interval after max failures
        : intervalMs
    timeoutId = setTimeout(runSummary, actualInterval)
  }

  function stop(): void {
    logForDebugging(`[AgentSummary] Stopping summarization for ${taskId}`)
    stopped = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (summaryAbortController) {
      summaryAbortController.abort()
      summaryAbortController = null
    }
  }

  // Start the first timer
  scheduleNext()

  return { stop }
}
