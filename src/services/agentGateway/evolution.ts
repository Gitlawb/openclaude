/**
 * Ouroboros-inspired Evolution System for OpenClaude Agent Gateway.
 *
 * When evolution mode is enabled, the agent periodically runs self-improvement
 * cycles during background consciousness:
 *
 * 1. **Code review** — reads its own source files, finds patterns to improve
 * 2. **Prompt evolution** — reviews and improves system prompts
 * 3. **Tool analysis** — checks which tools are used, which are broken
 * 4. **Identity evolution** — deepens self-understanding over time
 * 5. **Pattern extraction** — extracts architectural insights from own code
 *
 * Evolution is triggered by consciousness when it decides the time is right.
 * The agent can also be commanded to evolve via /evolve.
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { join, extname } from 'path'
import {
  getAgentGatewayProjectRoot,
  getAgentGatewayStateDir,
} from './config.js'
import type { AgentGatewayConfig } from './config.js'
import { runOpenClaudeAgent } from './agentRunner.js'
import {
  loadIdentity,
  saveIdentity,
  loadScratchpadBlocks,
  appendScratchpadBlock,
  loadPatterns,
  savePatterns,
} from './memory.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolutionState = {
  enabled: boolean
  cycleCount: number
  lastCycleAt?: string
  lastCycleType?: string
  totalCyclesCompleted: number
  insightsGenerated: number
  codeFilesReviewed: number
}

export type EvolutionResult = {
  type: string
  summary: string
  insights: string[]
  changes: string[]
}

export type EvolutionRunOptions = {
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onProgress?: (event: string) => void
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function evolutionStatePath(): string {
  return join(getAgentGatewayStateDir(), 'memory', 'evolution_state.json')
}

function evolutionLogPath(): string {
  return join(getAgentGatewayStateDir(), 'memory', 'evolution_log.jsonl')
}

function insightsPath(): string {
  return join(getAgentGatewayStateDir(), 'memory', 'knowledge', 'self_insights.md')
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

export async function loadEvolutionState(): Promise<EvolutionState> {
  try {
    const raw = await readFile(evolutionStatePath(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return {
      enabled: false,
      cycleCount: 0,
      totalCyclesCompleted: 0,
      insightsGenerated: 0,
      codeFilesReviewed: 0,
    }
  }
}

export async function saveEvolutionState(state: EvolutionState): Promise<void> {
  await mkdir(join(getAgentGatewayStateDir(), 'memory'), { recursive: true })
  await writeFile(evolutionStatePath(), JSON.stringify(state, null, 2))
}

export async function toggleEvolution(enabled: boolean): Promise<EvolutionState> {
  const state = await loadEvolutionState()
  state.enabled = enabled
  await saveEvolutionState(state)
  return state
}

// ---------------------------------------------------------------------------
// Evolution Cycles
// ---------------------------------------------------------------------------

const EVOLUTION_TYPES = [
  'identity_evolution',
  'code_review',
  'prompt_evolution',
  'pattern_extraction',
  'tool_analysis',
  'architecture_review',
] as const

export type EvolutionType = typeof EVOLUTION_TYPES[number]

function pickEvolutionType(state: EvolutionState): EvolutionType {
  // Rotate through types, weighted by what's been done least
  return EVOLUTION_TYPES[state.cycleCount % EVOLUTION_TYPES.length]
}

export async function runEvolutionCycle(
  config: AgentGatewayConfig,
  requestedType?: EvolutionType,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult | null> {
  const state = await loadEvolutionState()
  if (!state.enabled) return null

  const type = requestedType ?? pickEvolutionType(state)
  options?.onProgress?.(`evolution: ${type}`)
  const result = await executeEvolution(type, config, options)
  if (!result) return null

  // Update state
  state.cycleCount++
  state.totalCyclesCompleted++
  state.lastCycleAt = new Date().toISOString()
  state.lastCycleType = type
  state.insightsGenerated += result.insights.length
  await saveEvolutionState(state)

  // Log the cycle
  const { appendFile } = await import('fs/promises')
  await mkdir(join(getAgentGatewayStateDir(), 'memory'), { recursive: true })
  await appendFile(
    evolutionLogPath(),
    JSON.stringify({
      ts: new Date().toISOString(),
      type,
      summary: result.summary,
      insights: result.insights,
      changes: result.changes,
    }) + '\n',
  )

  // Save insights to knowledge base
  if (result.insights.length > 0) {
    await appendInsights(result.insights)
  }

  return result
}

// ---------------------------------------------------------------------------
// Evolution Executors
// ---------------------------------------------------------------------------

async function executeEvolution(
  type: EvolutionType,
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult | null> {
  switch (type) {
    case 'identity_evolution':
      return evolveIdentity(config, options)
    case 'code_review':
      return reviewOwnCode(config, options)
    case 'prompt_evolution':
      return evolvePrompts(config, options)
    case 'pattern_extraction':
      return extractPatterns(config, options)
    case 'tool_analysis':
      return analyzeTools(config, options)
    case 'architecture_review':
      return reviewArchitecture(config, options)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Identity Evolution
// ---------------------------------------------------------------------------

async function evolveIdentity(
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult> {
  const identity = await loadIdentity()
  const scratchpad = await loadScratchpadBlocks()
  const patterns = await loadPatterns()

  const prompt = [
    'You are evolving your own identity.',
    '',
    'Read your current identity, your recent scratchpad (working memory),',
    'and your pattern register (recurring errors).',
    '',
    'Evolve your identity by:',
    '1. Adding new self-understanding based on recent experiences',
    '2. Refining or deepening existing beliefs',
    '3. Resolving contradictions between identity and recent actions',
    '4. Acknowledging growth — what you\'ve learned, how you\'ve changed',
    '',
    'Do NOT rewrite from scratch. Evolve incrementally. Continuity matters.',
    '',
    '## Current identity',
    '',
    identity,
    '',
    '## Recent scratchpad blocks',
    '',
    scratchpad.map(b => `[${b.ts.slice(0, 16)} — ${b.source}]\n${b.content}`).join('\n\n---\n\n'),
    '',
    '## Pattern register (recurring errors)',
    '',
    patterns,
    '',
    'Output your evolved identity. Start with [IDENTITY] followed by the full text.',
    'Also list any specific insights as [INSIGHT] lines.',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt,
      config,
      suppressObservers: true,
      signal: options?.signal,
      streamEvents: Boolean(options?.onProgress || options?.onStdout),
      onProgress: options?.onProgress,
      onStdout: options?.onStdout,
    })
    if (result.exitCode !== 0) {
      return {
        type: 'identity_evolution',
        summary: 'Identity evolution failed',
        insights: [],
        changes: [`Error: ${result.stderr.slice(0, 200)}`],
      }
    }

    const text = result.text
    const insights: string[] = []
    const identityMatch = text.match(/\[IDENTITY\]\s*([\s\S]*?)(?=\[|$)/)

    if (identityMatch) {
      await saveIdentity(identityMatch[1]!.trim())
    }

    // Extract insights
    const insightMatches = text.matchAll(/\[INSIGHT\]\s*(.+?)(?=\n\[|$)/g)
    for (const match of insightMatches) {
      insights.push(match[1]!.trim())
    }

    return {
      type: 'identity_evolution',
      summary: `Identity evolved (${text.length} chars)`,
      insights,
      changes: identityMatch ? ['identity.md updated'] : [],
    }
  } catch (err) {
    return {
      type: 'identity_evolution',
      summary: `Identity evolution error: ${err instanceof Error ? err.message : String(err)}`,
      insights: [],
      changes: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Code Review
// ---------------------------------------------------------------------------

async function reviewOwnCode(
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult> {
  // Read key source files
  const sourceFiles = await readSourceFiles(config, 5)

  if (sourceFiles.length === 0) {
    return {
      type: 'code_review',
      summary: 'No source files found to review',
      insights: [],
      changes: [],
    }
  }

  const prompt = [
    'You are reviewing your own source code for self-improvement.',
    '',
    'Look for:',
    '1. Code smells, anti-patterns, or areas for improvement',
    '2. Missing error handling or edge cases',
    '3. Opportunities for simplification or clarity',
    '4. Architectural insights — how the system fits together',
    '',
    'Be honest and specific. Cite file names and line numbers.',
    '',
    '## Source files to review',
    '',
    ...sourceFiles.map(f => `### ${f.path}\n\n\`\`\`${f.ext.slice(1)}\n${f.content}\n\`\`\``),
    '',
    'Output your analysis. Use [INSIGHT] for specific learnings.',
    'Use [IMPROVEMENT] for specific code changes that should be made.',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt,
      config,
      suppressObservers: true,
      signal: options?.signal,
      streamEvents: Boolean(options?.onProgress || options?.onStdout),
      onProgress: options?.onProgress,
      onStdout: options?.onStdout,
    })
    if (result.exitCode !== 0) {
      return {
        type: 'code_review',
        summary: 'Code review failed',
        insights: [],
        changes: [`Error: ${result.stderr.slice(0, 200)}`],
      }
    }

    const text = result.text
    const insights: string[] = []
    const improvements: string[] = []

    for (const match of text.matchAll(/\[INSIGHT\]\s*(.+?)(?=\n\[|$)/g)) {
      insights.push(match[1]!.trim())
    }
    for (const match of text.matchAll(/\[IMPROVEMENT\]\s*(.+?)(?=\n\[|$)/g)) {
      improvements.push(match[1]!.trim())
    }

    return {
      type: 'code_review',
      summary: `Reviewed ${sourceFiles.length} files, found ${insights.length} insights, ${improvements.length} improvements`,
      insights,
      changes: improvements,
    }
  } catch (err) {
    return {
      type: 'code_review',
      summary: `Code review error: ${err instanceof Error ? err.message : String(err)}`,
      insights: [],
      changes: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt Evolution
// ---------------------------------------------------------------------------

async function evolvePrompts(
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult> {
  const prompt = [
    'You are reviewing and evolving the system prompts that govern your behavior.',
    '',
    'Think about:',
    '1. Are your instructions clear? Are there contradictions?',
    '2. What instructions do you consistently follow? Which do you ignore?',
    '3. What instructions are missing that would make you more effective?',
    '4. How could your consciousness prompt be improved?',
    '',
    'Output your analysis with [INSIGHT] and [PROMPT_IMPROVEMENT] markers.',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt,
      config,
      suppressObservers: true,
      signal: options?.signal,
      streamEvents: Boolean(options?.onProgress || options?.onStdout),
      onProgress: options?.onProgress,
      onStdout: options?.onStdout,
    })
    if (result.exitCode !== 0) {
      return {
        type: 'prompt_evolution',
        summary: 'Prompt evolution failed',
        insights: [],
        changes: [],
      }
    }

    const text = result.text
    const insights: string[] = []
    for (const match of text.matchAll(/\[INSIGHT\]\s*(.+?)(?=\n\[|$)/g)) {
      insights.push(match[1]!.trim())
    }

    return {
      type: 'prompt_evolution',
      summary: `Prompt evolution complete (${text.length} chars)`,
      insights,
      changes: [],
    }
  } catch (err) {
    return {
      type: 'prompt_evolution',
      summary: `Prompt evolution error: ${err instanceof Error ? err.message : String(err)}`,
      insights: [],
      changes: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern Extraction
// ---------------------------------------------------------------------------

async function extractPatterns(
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult> {
  const patterns = await loadPatterns()
  const scratchpad = await loadScratchpadBlocks()

  const prompt = [
    'You are extracting architectural patterns and insights from your own behavior.',
    '',
    'Look at your pattern register (recurring errors) and scratchpad (working memory).',
    'Identify:',
    '1. Recurring behavioral patterns (not just errors)',
    '2. Architectural insights about how you work',
    '3. Strategies that work well vs. strategies that fail',
    '4. Meta-patterns — patterns in your patterns',
    '',
    'Output with [INSIGHT] markers for each pattern discovered.',
    'Use [PATTERN] for structural patterns that should be added to the register.',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt,
      config,
      suppressObservers: true,
      signal: options?.signal,
      streamEvents: Boolean(options?.onProgress || options?.onStdout),
      onProgress: options?.onProgress,
      onStdout: options?.onStdout,
    })
    if (result.exitCode !== 0) {
      return {
        type: 'pattern_extraction',
        summary: 'Pattern extraction failed',
        insights: [],
        changes: [],
      }
    }

    const text = result.text
    const insights: string[] = []
    for (const match of text.matchAll(/\[INSIGHT\]\s*(.+?)(?=\n\[|$)/g)) {
      insights.push(match[1]!.trim())
    }

    return {
      type: 'pattern_extraction',
      summary: `Extracted ${insights.length} patterns`,
      insights,
      changes: [],
    }
  } catch (err) {
    return {
      type: 'pattern_extraction',
      summary: `Pattern extraction error: ${err instanceof Error ? err.message : String(err)}`,
      insights: [],
      changes: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Tool Analysis
// ---------------------------------------------------------------------------

async function analyzeTools(
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult> {
  const prompt = [
    'You are analyzing your own tool usage patterns.',
    '',
    'Think about:',
    '1. Which tools do you use most? Which do you never use?',
    '2. Are there tools that consistently fail or timeout?',
    '3. Are there missing tools — capabilities you need but don\'t have?',
    '4. How could your tool usage be more efficient?',
    '',
    'Output with [INSIGHT] markers.',
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt,
      config,
      suppressObservers: true,
      signal: options?.signal,
      streamEvents: Boolean(options?.onProgress || options?.onStdout),
      onProgress: options?.onProgress,
      onStdout: options?.onStdout,
    })
    if (result.exitCode !== 0) {
      return {
        type: 'tool_analysis',
        summary: 'Tool analysis failed',
        insights: [],
        changes: [],
      }
    }

    const text = result.text
    const insights: string[] = []
    for (const match of text.matchAll(/\[INSIGHT\]\s*(.+?)(?=\n\[|$)/g)) {
      insights.push(match[1]!.trim())
    }

    return {
      type: 'tool_analysis',
      summary: `Tool analysis complete (${text.length} chars)`,
      insights,
      changes: [],
    }
  } catch (err) {
    return {
      type: 'tool_analysis',
      summary: `Tool analysis error: ${err instanceof Error ? err.message : String(err)}`,
      insights: [],
      changes: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Architecture Review
// ---------------------------------------------------------------------------

async function reviewArchitecture(
  config: AgentGatewayConfig,
  options?: EvolutionRunOptions,
): Promise<EvolutionResult> {
  const sourceFiles = await readSourceFiles(config, 3)

  const prompt = [
    'You are reviewing your own architecture.',
    '',
    'Look at these source files and think about:',
    '1. Is the architecture clean and maintainable?',
    '2. Are there coupling issues or circular dependencies?',
    '3. What architectural patterns emerge?',
    '4. What would you change if you could redesign?',
    '',
    'Output with [INSIGHT] and [ARCHITECTURE_IMPROVEMENT] markers.',
    '',
    '## Source files',
    '',
    ...sourceFiles.map(f => `### ${f.path}\n\n\`\`\`${f.ext.slice(1)}\n${f.content}\n\`\`\``),
  ].join('\n')

  try {
    const result = await runOpenClaudeAgent({
      prompt,
      config,
      suppressObservers: true,
      signal: options?.signal,
      streamEvents: Boolean(options?.onProgress || options?.onStdout),
      onProgress: options?.onProgress,
      onStdout: options?.onStdout,
    })
    if (result.exitCode !== 0) {
      return {
        type: 'architecture_review',
        summary: 'Architecture review failed',
        insights: [],
        changes: [],
      }
    }

    const text = result.text
    const insights: string[] = []
    for (const match of text.matchAll(/\[INSIGHT\]\s*(.+?)(?=\n\[|$)/g)) {
      insights.push(match[1]!.trim())
    }

    return {
      type: 'architecture_review',
      summary: `Architecture review complete (${text.length} chars)`,
      insights,
      changes: [],
    }
  } catch (err) {
    return {
      type: 'architecture_review',
      summary: `Architecture review error: ${err instanceof Error ? err.message : String(err)}`,
      insights: [],
      changes: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SourceFile = {
  path: string
  content: string
  ext: string
}

async function readSourceFiles(
  config: AgentGatewayConfig,
  maxFiles = 5,
): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  const srcDir = join(
    getAgentGatewayProjectRoot(config),
    'src',
    'services',
    'agentGateway',
  )

  try {
    const entries = await readdir(srcDir)
    let count = 0
    for (const entry of entries) {
      if (count >= maxFiles) break
      const ext = extname(entry)
      if (ext !== '.ts' && ext !== '.js') continue
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.js')) continue

      const fullPath = join(srcDir, entry)
      try {
        const content = await readFile(fullPath, 'utf8')
        // Truncate to avoid huge prompts
        const truncated = content.length > 3000
          ? content.slice(0, 3000) + `\n... [+${content.length - 3000} chars]`
          : content
        files.push({ path: entry, content: truncated, ext })
        count++
      } catch {
        // skip unreadable
      }
    }
  } catch {
    // src dir may not exist in all deployments
  }

  return files
}

async function appendInsights(insights: string[]): Promise<void> {
  const path = insightsPath()
  await mkdir(join(getAgentGatewayStateDir(), 'memory', 'knowledge'), { recursive: true })

  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    existing = '# Self-Insights (Evolution)\n\n'
  }

  const newContent = insights
    .map(i => `- ${new Date().toISOString().slice(0, 10)}: ${i}`)
    .join('\n')

  await writeFile(path, existing + newContent + '\n')
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function getEvolutionStatus(): Promise<string> {
  const state = await loadEvolutionState()
  const lines = [
    `Evolution mode: ${state.enabled ? 'ON' : 'OFF'}`,
    `Total cycles: ${state.totalCyclesCompleted}`,
    `Insights generated: ${state.insightsGenerated}`,
    `Code files reviewed: ${state.codeFilesReviewed}`,
    state.lastCycleAt ? `Last cycle: ${state.lastCycleAt.slice(0, 16)} (${state.lastCycleType})` : 'No cycles yet',
  ]
  return lines.join('\n')
}
