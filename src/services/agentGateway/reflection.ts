/**
 * Ouroboros-inspired Reflection System for OpenClaude Agent Gateway.
 *
 * Generates brief LLM summaries of task execution when errors occurred.
 * Stored in task_reflections.jsonl and loaded into the next task's context,
 * giving the agent visibility into its own process across task boundaries.
 *
 * Process memory is as essential as factual memory — seeing the class of
 * error requires seeing the process that produced it.
 */

import { mkdir, readFile, writeFile, appendFile } from 'fs/promises'
import { join } from 'path'
import { getAgentGatewayStateDir } from './config.js'
import type { AgentGatewayConfig } from './config.js'
import { runOpenClaudeAgent } from './agentRunner.js'
import { updatePatternRegister } from './consolidation.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskReflection = {
  ts: string
  taskId: string
  taskType: string
  goal: string
  rounds: number
  costUsd: number
  errorCount: number
  keyMarkers: string[]
  reflection: string
}

export type TaskTrace = {
  taskId: string
  taskType: string
  goal: string
  rounds: number
  costUsd: number
  toolCalls: ToolCallTrace[]
  finalText: string
  exitCode: number
  stderr: string
  durationMs: number
}

export type ToolCallTrace = {
  tool: string
  args: Record<string, unknown>
  result: string
  isError: boolean
  durationMs?: number
}

// ---------------------------------------------------------------------------
// Error markers that trigger reflection
// ---------------------------------------------------------------------------

const ERROR_MARKERS = new Set([
  'REVIEW_BLOCKED',
  'TESTS_FAILED',
  'COMMIT_BLOCKED',
  'REVIEW_MAX_ITERATIONS',
  'TOOL_ERROR',
  'TOOL_TIMEOUT',
  'AGENT_FAILED',
  'EXIT_CODE_NONZERO',
])

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function reflectionsPath(): string {
  return join(getAgentGatewayStateDir(), 'logs', 'task_reflections.jsonl')
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function shouldGenerateReflection(trace: TaskTrace): boolean {
  for (const tc of trace.toolCalls) {
    if (tc.isError) return true
    for (const marker of ERROR_MARKERS) {
      if (tc.result.includes(marker)) return true
    }
  }
  return false
}

export function detectMarkers(trace: TaskTrace): string[] {
  const found = new Set<string>()
  for (const tc of trace.toolCalls) {
    for (const marker of ERROR_MARKERS) {
      if (tc.result.includes(marker)) {
        found.add(marker)
      }
    }
  }
  return [...found].sort()
}

// ---------------------------------------------------------------------------
// Reflection Generation
// ---------------------------------------------------------------------------

const REFLECTION_PROMPT = `You are reviewing a completed task execution trace for the OpenClaude agent.
The task had errors. Write a concise 150-250 word reflection covering:

1. What was the goal?
2. What specific errors/blocks occurred?
3. What was the root cause (if identifiable)?
4. What should be done differently next time?

Be concrete — cite specific file names, tool names, error messages. No platitudes.

## Task goal

{goal}

## Execution trace

{trace_summary}

## Error details

{error_details}

Write the reflection now. Plain text, no markdown headers.`

export async function generateReflection(
  trace: TaskTrace,
  config: AgentGatewayConfig,
): Promise<TaskReflection | null> {
  const goal = truncate(trace.goal, 200)
  const errorDetails = collectErrorDetails(trace)
  const markers = detectMarkers(trace)
  const errorCount = trace.toolCalls.filter(tc => tc.isError).length

  const prompt = REFLECTION_PROMPT
    .replace('{goal}', goal || '(no goal text)')
    .replace('{trace_summary}', truncate(buildTraceSummary(trace), 2000))
    .replace('{error_details}', errorDetails)

  try {
    const result = await runOpenClaudeAgent({ prompt, config, suppressObservers: true })
    if (result.exitCode !== 0) return null

    const reflectionText = result.text.trim()
    if (!reflectionText) return null

    return {
      ts: new Date().toISOString(),
      taskId: trace.taskId,
      taskType: trace.taskType,
      goal,
      rounds: trace.rounds,
      costUsd: trace.costUsd,
      errorCount,
      keyMarkers: markers,
      reflection: reflectionText,
    }
  } catch {
    return null
  }
}

export async function appendReflection(reflection: TaskReflection): Promise<void> {
  const path = reflectionsPath()
  await mkdir(join(getAgentGatewayStateDir(), 'logs'), { recursive: true })
  const line = JSON.stringify(reflection) + '\n'
  await appendFile(path, line)
}

// ---------------------------------------------------------------------------
// Post-Task Reflection Pipeline
// ---------------------------------------------------------------------------

export async function processTaskReflection(
  trace: TaskTrace,
  config: AgentGatewayConfig,
): Promise<void> {
  if (!shouldGenerateReflection(trace)) return

  const reflection = await generateReflection(trace, config)
  if (!reflection) return

  await appendReflection(reflection)

  // Update pattern register for recurring errors
  if (reflection.keyMarkers.length > 0) {
    await updatePatternRegister(
      reflection.keyMarkers.join(', '),
      reflection.reflection.slice(0, 500),
      config,
    )
  }
}

// ---------------------------------------------------------------------------
// Loading Recent Reflections (for context injection)
// ---------------------------------------------------------------------------

export async function loadRecentReflections(
  count = 5,
): Promise<TaskReflection[]> {
  try {
    const raw = await readFile(reflectionsPath(), 'utf8')
    const lines = raw.split('\n').filter(line => line.trim())
    const entries: TaskReflection[] = []
    for (const line of lines.slice(-count * 2)) {
      try {
        entries.push(JSON.parse(line))
      } catch {
        // skip malformed
      }
    }
    return entries.slice(-count)
  } catch {
    return []
  }
}

export async function buildReflectionContextSection(): Promise<string> {
  const reflections = await loadRecentReflections(3)
  if (reflections.length === 0) return ''

  const parts = ['\n## Recent task reflections (process memory)\n']
  for (const r of reflections) {
    parts.push(`### ${r.taskType} — ${r.ts.slice(0, 10)}`)
    parts.push(`Goal: ${r.goal}`)
    parts.push(`Errors: ${r.errorCount}, Markers: ${r.keyMarkers.join(', ') || 'none'}`)
    parts.push(r.reflection.slice(0, 500))
    parts.push('---')
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectErrorDetails(trace: TaskTrace, cap = 3000): string {
  const parts: string[] = []
  let total = 0

  for (const tc of trace.toolCalls) {
    const isRelevant = tc.isError || ERROR_MARKERS.has(tc.result) ||
      [...ERROR_MARKERS].some(m => tc.result.includes(m))
    if (!isRelevant) continue

    const snippet = `[${tc.tool}]: ${tc.result}`
    if (total + snippet.length > cap) {
      const remaining = cap - total
      if (remaining > 50) {
        parts.push(snippet.slice(0, remaining) + `... [+${snippet.length - remaining} chars]`)
      }
      break
    }
    parts.push(snippet)
    total += snippet.length
  }

  return parts.length > 0 ? parts.join('\n\n') : '(no error details captured)'
}

function buildTraceSummary(trace: TaskTrace): string {
  const lines = [
    `Task: ${trace.taskId} (${trace.taskType})`,
    `Goal: ${trace.goal}`,
    `Rounds: ${trace.rounds}`,
    `Cost: $${trace.costUsd.toFixed(4)}`,
    `Duration: ${trace.durationMs}ms`,
    `Exit code: ${trace.exitCode}`,
    `Tool calls: ${trace.toolCalls.length}`,
  ]

  if (trace.stderr) {
    lines.push(`Stderr: ${truncate(trace.stderr, 500)}`)
  }

  return lines.join('\n')
}

function truncate(text: string, limit: number): string {
  if (!text || text.length <= limit) return text
  return text.slice(0, limit) + `... [+${text.length - limit} chars]`
}
