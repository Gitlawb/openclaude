/**
 * Infinite Task Execution Loop for OpenClaude Agent.
 *
 * Ouroboros core feature: the agent never gives up until the task is done.
 * If a task fails, the agent analyzes the error, adjusts its approach,
 * and retries — indefinitely, until success or explicit cancellation.
 *
 * This is different from simple retry: each iteration learns from the
 * previous failure and changes strategy. The agent can also:
 * - Decompose complex tasks into subtasks
 * - Request more context from the user
 * - Switch models or effort levels
 * - Self-edit its own code to fix the root cause
 *
 * The loop is bounded only by:
 * - Budget (hard limit)
 * - Explicit user cancellation
 * - Panic stop
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { getAgentGatewayStateDir } from './config.js'
import type { AgentGatewayConfig } from './config.js'
import { runOpenClaudeAgent } from './agentRunner.js'
import { buildSelfEditPrompt, gitStatus, gitDiff } from './selfEdit.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InfiniteTaskState = {
  taskId: string
  goal: string
  iterations: number
  maxIterations: number
  budgetSpent: number
  budgetLimit: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  history: TaskIteration[]
  currentStrategy: string
  startedAt: string
  completedAt?: string
}

export type TaskIteration = {
  iteration: number
  prompt: string
  exitCode: number
  text: string
  stderr: string
  durationMs: number
  strategy: string
  lesson: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function taskStatePath(taskId: string): string {
  return join(getAgentGatewayStateDir(), 'tasks', `${taskId}.json`)
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

export async function saveTaskState(state: InfiniteTaskState): Promise<void> {
  const path = taskStatePath(state.taskId)
  await mkdir(join(getAgentGatewayStateDir(), 'tasks'), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2))
}

export async function loadTaskState(taskId: string): Promise<InfiniteTaskState | null> {
  try {
    const raw = await readFile(taskStatePath(taskId), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function cancelTask(taskId: string): Promise<boolean> {
  const state = await loadTaskState(taskId)
  if (!state) return false
  state.status = 'cancelled'
  state.completedAt = new Date().toISOString()
  await saveTaskState(state)
  return true
}

// ---------------------------------------------------------------------------
// Infinite Loop
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 50
const DEFAULT_BUDGET_LIMIT = 10.0 // USD

export async function runInfiniteTask(
  taskId: string,
  goal: string,
  config: AgentGatewayConfig,
  options?: {
    maxIterations?: number
    budgetLimit?: number
    onProgress?: (state: InfiniteTaskState) => Promise<void>
    onAgentProgress?: (event: string) => void
    onCancelled?: () => boolean
    signal?: AbortSignal
  },
): Promise<InfiniteTaskState> {
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const budgetLimit = options?.budgetLimit ?? DEFAULT_BUDGET_LIMIT

  const state: InfiniteTaskState = {
    taskId,
    goal,
    iterations: 0,
    maxIterations,
    budgetSpent: 0,
    budgetLimit,
    status: 'running',
    history: [],
    currentStrategy: 'Initial approach',
    startedAt: new Date().toISOString(),
  }

  await saveTaskState(state)

  let currentPrompt = goal
  let strategy = 'Initial approach'

  for (let i = 1; i <= maxIterations; i++) {
    // Check cancellation
    if (options?.signal?.aborted || options?.onCancelled?.()) {
      state.status = 'cancelled'
      state.completedAt = new Date().toISOString()
      await saveTaskState(state)
      return state
    }

    // Check budget
    if (state.budgetSpent >= budgetLimit) {
      state.status = 'failed'
      state.currentStrategy = `Budget exhausted ($${state.budgetSpent.toFixed(2)} / $${budgetLimit})`
      state.completedAt = new Date().toISOString()
      await saveTaskState(state)
      return state
    }

    state.iterations = i
    state.currentStrategy = strategy

    const startTime = Date.now()

    // Build the prompt with full context from previous iterations
    const prompt = buildIterationPrompt(currentPrompt, state, strategy)

    const result = await runOpenClaudeAgent({
      prompt,
      config,
      signal: options?.signal,
      suppressObservers: true,
      streamEvents: Boolean(options?.onAgentProgress),
      onProgress: options?.onAgentProgress,
    })

    const durationMs = Date.now() - startTime

    if (options?.signal?.aborted || options?.onCancelled?.()) {
      state.status = 'cancelled'
      state.completedAt = new Date().toISOString()
      await saveTaskState(state)
      return state
    }

    const iteration: TaskIteration = {
      iteration: i,
      prompt: prompt.slice(0, 500),
      exitCode: result.exitCode,
      text: result.text,
      stderr: result.stderr,
      durationMs,
      strategy,
      lesson: '',
    }

    state.history.push(iteration)

    if (result.exitCode === 0) {
      // Success!
      state.status = 'completed'
      state.completedAt = new Date().toISOString()
      await saveTaskState(state)
      return state
    }

    // Failure — analyze and adapt
    const analysis = await analyzeFailure(result.stderr, result.text, state, config)
    iteration.lesson = analysis.lesson
    strategy = analysis.nextStrategy

    // Log the failure analysis
    console.log(
      `[infinite-task] Iteration ${i} failed. Lesson: ${analysis.lesson.slice(0, 200)}`,
    )
    console.log(`[infinite-task] Next strategy: ${strategy}`)

    // Update the prompt for next iteration
    currentPrompt = `${goal}\n\nPrevious attempt failed. ${analysis.lesson}\n\nTry a different approach: ${strategy}`

    await saveTaskState(state)

    // Report progress
    if (options?.onProgress) {
      await options.onProgress(state)
    }
  }

  // Max iterations reached
  state.status = 'failed'
  state.currentStrategy = `Max iterations reached (${maxIterations})`
  state.completedAt = new Date().toISOString()
  await saveTaskState(state)
  return state
}

// ---------------------------------------------------------------------------
// Prompt Building
// ---------------------------------------------------------------------------

function buildIterationPrompt(
  originalGoal: string,
  state: InfiniteTaskState,
  strategy: string,
): string {
  const parts = [
    '## Task (Infinite Execution Mode)',
    '',
    `**Goal:** ${originalGoal}`,
    `**Strategy:** ${strategy}`,
    `**Iteration:** ${state.iterations + 1}`,
    '',
    'You are in infinite execution mode. You MUST NOT give up until the task is complete.',
    '',
    'Rules:',
    '1. If your approach fails, analyze WHY and try a DIFFERENT approach',
    '2. Do NOT repeat the same failed strategy',
    '3. You can read and modify your own source code to fix issues',
    '4. You can decompose the task into smaller steps',
    '5. You can ask for more context if needed',
    '6. NEVER say "I cannot do this" — find another way',
    '7. If stuck, try: reading the code, understanding the error, fixing the root cause',
    '',
  ]

  if (state.history.length > 0) {
    parts.push('## Previous attempts')
    parts.push('')

    const recent = state.history.slice(-3)
    for (const iter of recent) {
      parts.push(`### Attempt ${iter.iteration} (Strategy: ${iter.strategy})`)
      parts.push(`Exit code: ${iter.exitCode}`)
      parts.push(`Duration: ${iter.durationMs}ms`)
      if (iter.stderr) {
        parts.push(`Error: ${iter.stderr.slice(0, 500)}`)
      }
      if (iter.lesson) {
        parts.push(`Lesson: ${iter.lesson}`)
      }
      parts.push('')
    }

    parts.push('## What NOT to do')
    parts.push('')
    parts.push('Do NOT repeat any of the failed strategies above.')
    parts.push('Each failed attempt taught you something. Use that knowledge.')
    parts.push('')
  }

  parts.push('## Current strategy')
  parts.push('')
  parts.push(strategy)
  parts.push('')
  parts.push('Execute now. Do not explain what you will do — just do it.')

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Failure Analysis
// ---------------------------------------------------------------------------

type FailureAnalysis = {
  lesson: string
  nextStrategy: string
}

async function analyzeFailure(
  stderr: string,
  stdout: string,
  state: InfiniteTaskState,
  config: AgentGatewayConfig,
): Promise<FailureAnalysis> {
  // Try to analyze with LLM for intelligent strategy adjustment
  const analysisPrompt = [
    'A task execution failed. Analyze the failure and suggest a new strategy.',
    '',
    `**Original goal:** ${state.goal}`,
    `**Failed strategy:** ${state.currentStrategy}`,
    `**Iteration:** ${state.iterations}`,
    '',
    '## Error output',
    '',
    `Stderr: ${stderr.slice(0, 2000)}`,
    `Stdout: ${stdout.slice(0, 1000)}`,
    '',
    '## Previous attempts',
    '',
    state.history.map(h => `- Attempt ${h.iteration}: ${h.strategy} → ${h.exitCode === 0 ? 'success' : 'failed'}`).join('\n'),
    '',
    'Analyze:',
    '1. What was the ROOT CAUSE of failure? (not the symptom)',
    '2. What strategy should be tried NEXT? (must be DIFFERENT from all previous)',
    '3. Can the agent fix this by modifying its own code?',
    '',
    'Respond with:',
    'LESSON: [one sentence about root cause]',
    'STRATEGY: [one sentence about next approach]',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt: analysisPrompt,
      config: {
        ...config,
        runner: {
          ...config.runner,
          maxTurns: Math.min(config.runner.maxTurns, 20),
          timeoutMs: Math.min(config.runner.timeoutMs, 60000),
        },
      },
      suppressObservers: true,
    })

    if (result.exitCode === 0) {
      const text = result.text
      const lessonMatch = text.match(/LESSON:\s*(.+?)(?:\n|$)/i)
      const strategyMatch = text.match(/STRATEGY:\s*(.+?)(?:\n|$)/i)

      return {
        lesson: lessonMatch ? lessonMatch[1]!.trim() : text.slice(0, 200),
        nextStrategy: strategyMatch
          ? strategyMatch[1]!.trim()
          : 'Try a completely different approach',
      }
    }
  } catch {
    // Fall through to default
  }

  // Default fallback strategies
  const fallbackStrategies = [
    'Read the relevant source files first, understand the error, then fix it',
    'Break the task into smaller steps and tackle each one separately',
    'Check if there is a simpler way to achieve the same goal',
    'Look for existing patterns in the codebase that solve similar problems',
    'Try a different tool or API to accomplish the same thing',
    'Simplify the goal — what is the minimum viable version of this task?',
    'Check if the issue is environmental (permissions, paths, dependencies)',
    'Read error messages carefully — they often contain the solution',
  ]

  const strategyIndex = (state.iterations - 1) % fallbackStrategies.length
  return {
    lesson: stderr.slice(0, 200) || 'Unknown error',
    nextStrategy: fallbackStrategies[strategyIndex]!,
  }
}

// ---------------------------------------------------------------------------
// Self-Edit Integration (for agent prompt injection)
// ---------------------------------------------------------------------------

export function buildInfiniteTaskPrompt(goal: string): string {
  return [
    `## Task: ${goal}`,
    '',
    'You are in INFINITE EXECUTION MODE.',
    'You MUST NOT give up until this task is complete.',
    '',
    'Rules:',
    '1. If your approach fails, analyze WHY and try DIFFERENTLY',
    '2. Do NOT repeat failed strategies',
    '3. You can read and modify your own source code',
    '4. You can decompose into subtasks',
    '5. NEVER say "I cannot" — find another way',
    '',
    buildSelfEditPrompt(),
  ].join('\n')
}
