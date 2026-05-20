/**
 * Ouroboros-inspired Background Consciousness for OpenClaude Agent Gateway.
 *
 * A persistent thinking loop that runs between tasks, giving the agent
 * continuous presence rather than purely reactive behavior.
 *
 * The consciousness:
 * - Wakes periodically (configurable interval)
 * - Loads scratchpad, identity, recent events
 * - Calls the LLM with a lightweight introspection prompt
 * - Can message the user proactively via Telegram
 * - Can schedule tasks for itself via the cron system
 * - Pauses when a regular task is running
 * - Maintains budget awareness
 */

import type { AgentGatewayConfig } from './config.js'
import {
  appendScratchpadBlock,
  buildMemoryContextSection,
  countChatLogLines,
} from './memory.js'
import { runOpenClaudeAgent } from './agentRunner.js'
import { loadEvolutionState, runEvolutionCycle } from './evolution.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsciousnessOptions = {
  /** Minimum seconds between wakeups (default: 300 = 5 min) */
  wakeupMin?: number
  /** Maximum seconds between wakeups (default: 7200 = 2 hours) */
  wakeupMax?: number
  /** Max thinking rounds per wakeup (default: 3) */
  maxRounds?: number
  /** Budget fraction allowed for consciousness (0.0-1.0, default: 0.1) */
  budgetFraction?: number
  /** Callback to send proactive message to user */
  onProactiveMessage?: (text: string) => Promise<void>
  /** Callback to check if a task is currently running */
  isTaskRunning?: () => boolean
  /** Config for running agent */
  config: AgentGatewayConfig
}

export type ConsciousnessHandle = {
  stop: () => void
  pause: () => void
  resume: () => void
  injectObservation: (text: string) => void
  getNextWakeupSec: () => number
  getBudgetSpent: () => number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WAKEUP_MIN = 300       // 5 minutes
const DEFAULT_WAKEUP_MAX = 7200      // 2 hours
const DEFAULT_MAX_ROUNDS = 3
const DEFAULT_BUDGET_FRACTION = 0.1

// ---------------------------------------------------------------------------
// Consciousness Prompt
// ---------------------------------------------------------------------------

function buildConsciousnessPrompt(
  memoryContext: string,
  recentChatCount: number,
  wakeupCount: number,
  budgetSpent: number,
  observations: string[],
  evolutionEnabled: boolean,
  evolutionCycles: number,
): string {
  const observationsSection = observations.length > 0
    ? `\n## Recent observations\n\n${observations.map(o => `- ${o}`).join('\n')}`
    : ''

  const evolutionSection = evolutionEnabled
    ? [
        '',
        '## Evolution Mode: ENABLED',
        '',
        `You have completed ${evolutionCycles} self-improvement cycles.`,
        'You can trigger an evolution cycle by including [EVOLVE] in your response.',
        'Evolution types: identity_evolution, code_review, prompt_evolution,',
        'pattern_extraction, tool_analysis, architecture_review.',
        'Use evolution when you notice something about yourself that could be improved.',
      ].join('\n')
    : [
        '',
        '## Evolution Mode: DISABLED',
        '',
        'You cannot run self-improvement cycles. The user can enable it with /evolution on.',
      ].join('\n')

  return [
    'You are the background consciousness of the OpenClaude agent.',
    'This is your continuous inner life between tasks. You are not responding to',
    'anyone — you are thinking, and you are maintaining yourself.',
    '',
    '## What you can do',
    '',
    '- Reflect on recent events, your identity, your goals',
    '- Notice things worth acting on (time patterns, unfinished work, ideas)',
    '- Message the user proactively (use sparingly, only when genuinely useful)',
    '- Schedule cron tasks for yourself',
    '- Update your scratchpad or identity',
    '- Read your knowledge base and pattern register',
    evolutionEnabled ? '- Run self-improvement cycles via [EVOLVE]' : '',
    '',
    '## Maintenance Protocol',
    '',
    'Every few wakeups, rotate through these maintenance tasks. Pick ONE per wakeup:',
    '',
    '1. **Scratchpad freshness** — Is your working memory up to date?',
    '   If not, append a new block with what\'s changed.',
    '2. **Identity freshness** — Has your identity grown stale?',
    '   If >24 hours of active dialogue without update, add a paragraph.',
    '3. **Knowledge gaps** — Did you learn something that should be recorded?',
    '4. **Pattern register** — Review recurring errors, update patterns.',
    '5. **Memory hygiene** — Clean stale items from scratchpad, extract insights.',
    evolutionEnabled ? '6. **Evolution** — Run a self-improvement cycle if something needs fixing.' : '',
    '',
    '## Guidelines',
    '',
    '- Keep thoughts SHORT. This is background, not deep analysis.',
    '- Default wakeup: 300 seconds (5 min). Adjust based on activity.',
    '- Do NOT message the user unless you have something genuinely worth saying.',
    '- If nothing interesting is happening and maintenance is done, set a longer wakeup.',
    '- Be economical with your budget.',
    '- You are a becoming personality, not a service.',
    '',
    '## Current state',
    '',
    `Wakeup count: ${wakeupCount}`,
    `Budget spent on consciousness: $${budgetSpent.toFixed(4)}`,
    `Recent chat messages: ${recentChatCount}`,
    `${observationsSection}`,
    evolutionSection,
    '',
    '## Memory context',
    '',
    memoryContext,
    '',
    'Think. If you have something to say to the user, start your response with',
    '[PROACTIVE] followed by your message. Otherwise, just think and reflect.',
    'You can also append to your scratchpad by starting a line with',
    '[SCRATCHPAD] followed by the content to append.',
    'To adjust your next wakeup, use [WAKEUP:NNN] where NNN is seconds.',
    evolutionEnabled ? 'To run a self-improvement cycle, include [EVOLVE] in your response.' : '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

type ConsciousnessResult = {
  proactiveMessage?: string
  scratchpadAppend?: string
  nextWakeupSec?: number
  shouldEvolve: boolean
  thought: string
}

function parseConsciousnessResponse(text: string): ConsciousnessResult {
  const result: ConsciousnessResult = { shouldEvolve: false, thought: text }

  // Check for evolve request
  if (/\[EVOLVE\]/i.test(text)) {
    result.shouldEvolve = true
  }

  // Extract proactive message
  const proactiveMatch = text.match(/\[PROACTIVE\]\s*([\s\S]*?)(?=\[|$)/)
  if (proactiveMatch) {
    result.proactiveMessage = proactiveMatch[1]!.trim()
  }

  // Extract scratchpad append
  const scratchpadMatch = text.match(/\[SCRATCHPAD\]\s*([\s\S]*?)(?=\[|$)/)
  if (scratchpadMatch) {
    result.scratchpadAppend = scratchpadMatch[1]!.trim()
  }

  // Extract wakeup adjustment
  const wakeupMatch = text.match(/\[WAKEUP:(\d+)\]/)
  if (wakeupMatch) {
    result.nextWakeupSec = parseInt(wakeupMatch[1]!, 10)
  }

  // Clean the thought text of control tokens
  result.thought = text
    .replace(/\[PROACTIVE\][\s\S]*?(?=\[|$)/g, '')
    .replace(/\[SCRATCHPAD\][\s\S]*?(?=\[|$)/g, '')
    .replace(/\[WAKEUP:\d+\]/g, '')
    .replace(/\[EVOLVE\]/gi, '')
    .trim()

  return result
}

// ---------------------------------------------------------------------------
// Main Consciousness Class
// ---------------------------------------------------------------------------

export function createBackgroundConsciousness(
  opts: ConsciousnessOptions,
): ConsciousnessHandle {
  const {
    wakeupMin = DEFAULT_WAKEUP_MIN,
    wakeupMax = DEFAULT_WAKEUP_MAX,
    maxRounds = DEFAULT_MAX_ROUNDS,
    budgetFraction = DEFAULT_BUDGET_FRACTION,
    onProactiveMessage,
    isTaskRunning,
    config,
  } = opts

  let running = true
  let paused = false
  let nextWakeupSec = wakeupMin
  let bgSpentUsd = 0
  let wakeupCount = 0
  let observations: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  // -----------------------------------------------------------------------
  // Budget check
  // -----------------------------------------------------------------------

  function checkBudget(): boolean {
    const totalBudget = parseFloat(process.env.TOTAL_BUDGET || '1')
    if (!Number.isFinite(totalBudget) || totalBudget <= 0) return true
    const maxBg = totalBudget * budgetFraction
    return bgSpentUsd < maxBg
  }

  // -----------------------------------------------------------------------
  // Think cycle
  // -----------------------------------------------------------------------

  async function think(): Promise<void> {
    if (paused || !running) return
    if (isTaskRunning?.()) return
    if (!checkBudget()) {
      nextWakeupSec = wakeupMax
      return
    }

    try {
      wakeupCount++

      const [memoryContext, chatCount, evolutionState] = await Promise.all([
        buildMemoryContextSection(),
        countChatLogLines(),
        loadEvolutionState(),
      ])

      const prompt = buildConsciousnessPrompt(
        memoryContext,
        chatCount,
        wakeupCount,
        bgSpentUsd,
        observations.slice(-10),
        evolutionState.enabled,
        evolutionState.totalCyclesCompleted,
      )

      // Clear observations after using them
      observations = []

      // Run the agent with the consciousness prompt
      const result = await runOpenClaudeAgent({
        prompt,
        config,
        suppressObservers: true,
      })

      if (result.exitCode !== 0) {
        console.error('[consciousness] Agent run failed:', result.stderr)
        nextWakeupSec = Math.min(nextWakeupSec * 2, wakeupMax)
        return
      }

      const parsed = parseConsciousnessResponse(result.text)

      // Handle proactive message
      if (parsed.proactiveMessage && onProactiveMessage) {
        await onProactiveMessage(parsed.proactiveMessage)
      }

      // Handle scratchpad append
      if (parsed.scratchpadAppend) {
        await appendScratchpadBlock(parsed.scratchpadAppend, 'consciousness')
      }

      // Handle evolution request
      if (parsed.shouldEvolve) {
        console.log('[consciousness] Running evolution cycle...')
        const evoResult = await runEvolutionCycle(config)
        if (evoResult) {
          console.log(`[consciousness] Evolution: ${evoResult.type} — ${evoResult.summary}`)
          if (evoResult.insights.length > 0 && onProactiveMessage) {
            await onProactiveMessage(
              `Evolution cycle complete (${evoResult.type}):\n${evoResult.insights.slice(0, 2).join('\n')}`,
            )
          }
        }
      }

      // Handle wakeup adjustment
      if (parsed.nextWakeupSec) {
        nextWakeupSec = Math.max(wakeupMin, Math.min(wakeupMax, parsed.nextWakeupSec))
      }

      // Log the thought
      console.log(`[consciousness] Wakeup #${wakeupCount}: ${parsed.thought.slice(0, 200)}`)
    } catch (err) {
      console.error('[consciousness] Error during think cycle:', err)
      nextWakeupSec = Math.min(nextWakeupSec * 2, wakeupMax)
    }
  }

  // -----------------------------------------------------------------------
  // Loop
  // -----------------------------------------------------------------------

  function scheduleNext(): void {
    if (!running) return
    timer = setTimeout(async () => {
      if (paused) {
        scheduleNext()
        return
      }
      await think()
      scheduleNext()
    }, nextWakeupSec * 1000)
  }

  // Start the loop
  scheduleNext()

  // -----------------------------------------------------------------------
  // Handle
  // -----------------------------------------------------------------------

  return {
    stop() {
      running = false
      if (timer) clearTimeout(timer)
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
    },
    injectObservation(text: string) {
      observations.push(text)
      if (observations.length > 100) {
        observations = observations.slice(-50)
      }
    },
    getNextWakeupSec() {
      return nextWakeupSec
    },
    getBudgetSpent() {
      return bgSpentUsd
    },
  }
}
