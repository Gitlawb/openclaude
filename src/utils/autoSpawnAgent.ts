/**
 * Auto-spawn de Plan/Review agents em background quando task é complexa.
 * Alternativa local ao Ultraplan/Ultrareview do Claude Code.
 */

import { randomUUID } from 'crypto'
import { logForDebugging } from './debug.js'
import type { ComplexityAnalysis } from './taskComplexityDetector.js'
import { analyzeTaskComplexity, shouldAutoSpawn } from './taskComplexityDetector.js'

export interface AutoSpawnConfig {
  enabled: boolean
  planThreshold: number // 0-1, default 0.5
  reviewThreshold: number // 0-1, default 0.5
  notifyOnComplete: boolean
}

const DEFAULT_CONFIG: AutoSpawnConfig = {
  enabled: true,
  planThreshold: 0.5,
  reviewThreshold: 0.5,
  notifyOnComplete: true,
}

/**
 * Analisa user prompt e auto-spawna agents se necessário.
 * Retorna IDs dos agents spawnados.
 */
export async function autoSpawnAgentsIfNeeded(
  userPrompt: string,
  config: Partial<AutoSpawnConfig> = {},
): Promise<{ planAgentId?: string; reviewAgentId?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  if (!cfg.enabled) {
    return {}
  }

  const analysis = analyzeTaskComplexity(userPrompt)

  logForDebugging(
    `[AutoSpawn] Analysis: planning=${analysis.needsPlanning} review=${analysis.needsReview} confidence=${analysis.confidence}`,
  )
  logForDebugging(`[AutoSpawn] Reasons: ${analysis.reasons.join('; ')}`)

  if (!shouldAutoSpawn(analysis)) {
    logForDebugging('[AutoSpawn] Confidence too low, skipping')
    return {}
  }

  const result: { planAgentId?: string; reviewAgentId?: string } = {}

  // Spawn Plan agent se necessário
  if (analysis.needsPlanning && analysis.confidence >= cfg.planThreshold) {
    result.planAgentId = await spawnPlanAgent(userPrompt, cfg)
  }

  // Spawn Review agent se necessário
  if (analysis.needsReview && analysis.confidence >= cfg.reviewThreshold) {
    result.reviewAgentId = await spawnReviewAgent(userPrompt, cfg)
  }

  return result
}

/**
 * Spawna Plan agent em background.
 */
async function spawnPlanAgent(
  userPrompt: string,
  config: AutoSpawnConfig,
): Promise<string> {
  const agentId = randomUUID()

  logForDebugging(`[AutoSpawn] Spawning Plan agent ${agentId}`)

  // TODO: Integrar com Agent tool
  // Por enquanto só log, implementação real precisa:
  // 1. Chamar Agent tool com subagent_type="Plan"
  // 2. run_in_background=true
  // 3. Salvar plano em ~/.openclaude/plans/
  // 4. Notificar quando completo

  return agentId
}

/**
 * Spawna Review agent em background.
 */
async function spawnReviewAgent(
  userPrompt: string,
  config: AutoSpawnConfig,
): Promise<string> {
  const agentId = randomUUID()

  logForDebugging(`[AutoSpawn] Spawning Review agent ${agentId}`)

  // Detectar target do review (branch, PR, ou files)
  const target = extractReviewTarget(userPrompt)

  // Spawn review em background
  const { runLocalReview } = await import('./localReview.js')

  // Fire and forget - review roda em background
  runLocalReview(target)
    .then((report) => {
      logForDebugging(`[AutoSpawn] Review ${agentId} complete: ${report.reportPath}`)
      // TODO: Notificar usuário quando completo
    })
    .catch((err) => {
      logForDebugging(`[AutoSpawn] Review ${agentId} failed: ${err}`)
    })

  return agentId
}

/**
 * Extrai target do review do user prompt.
 */
function extractReviewTarget(prompt: string): {
  type: 'branch' | 'pr' | 'files'
  value: string
} {
  const lower = prompt.toLowerCase()

  // Check for PR number
  const prMatch = prompt.match(/\b(?:pr|pull request)\s*#?(\d+)/i)
  if (prMatch) {
    return { type: 'pr', value: prMatch[1] }
  }

  // Check for branch name
  const branchMatch = prompt.match(/\bbranch\s+([a-z0-9/_-]+)/i)
  if (branchMatch) {
    return { type: 'branch', value: branchMatch[1] }
  }

  // Check for file paths
  const fileMatch = prompt.match(/\b(src\/[^\s]+|[^\s]+\.(?:ts|js|tsx|jsx|py|go|rs))/i)
  if (fileMatch) {
    return { type: 'files', value: fileMatch[1] }
  }

  // Default: current branch
  return { type: 'branch', value: 'HEAD' }
}

/**
 * Hook para integrar no query flow.
 * Chama antes de processar user message.
 */
export async function autoSpawnHook(userPrompt: string): Promise<void> {
  const result = await autoSpawnAgentsIfNeeded(userPrompt)

  if (result.planAgentId) {
    logForDebugging(`[AutoSpawn] Plan agent running: ${result.planAgentId}`)
  }

  if (result.reviewAgentId) {
    logForDebugging(`[AutoSpawn] Review agent running: ${result.reviewAgentId}`)
  }
}
