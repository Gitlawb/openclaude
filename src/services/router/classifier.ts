import type { Tier, ClassifierResult, EscalationRule } from './types.js'
import { checkEscalation } from './escalationRules.js'

const TASK_TYPE_TIERS: Record<string, Tier> = {
  explore: 'T0', 'file-search': 'T0', grep: 'T0', glob: 'T0', read: 'T0', summarize: 'T0',
  'code-gen': 'T1', scaffold: 'T1', refactor: 'T1', 'test-write': 'T1', implement: 'T1', default: 'T1',
  debug: 'T2', 'complex-logic': 'T2', reasoning: 'T2',
  'code-review': 'T3',
  'security-review': 'T4', architecture: 'T4', design: 'T4',
}

const TASK_TYPE_PATTERNS: [RegExp, string][] = [
  [/\b(explore|search|find|grep|look for|locate)\b/i, 'explore'],
  [/\b(scaffold|generate|create|build|add|implement|write)\b.*\b(component|function|class|module|api|endpoint|route)/i, 'code-gen'],
  [/\b(refactor|rename|move|extract|clean up)\b/i, 'refactor'],
  [/\b(test|spec|assert|expect)\b/i, 'test-write'],
  [/\b(debug|fix|bug|error|broken|failing|crash|trace|stack)\b/i, 'debug'],
  [/\b(review|audit|check|inspect|validate)\b.*\b(code|changes|pr|pull request)\b/i, 'code-review'],
  [/\b(design|architect|plan|schema|structure)\b/i, 'design'],
]

function detectTaskType(prompt: string, agentName?: string, subagentType?: string): string {
  if (subagentType) {
    const lower = subagentType.toLowerCase().replace(/[-_]/g, '')
    if (lower === 'explore') return 'explore'
    if (lower === 'plan') return 'design'
    if (lower === 'codereviewer') return 'code-review'
  }
  if (agentName) {
    const lower = agentName.toLowerCase()
    for (const [key] of Object.entries(TASK_TYPE_TIERS)) {
      if (lower.includes(key.replace('-', ''))) return key
    }
  }
  for (const [pattern, taskType] of TASK_TYPE_PATTERNS) {
    if (pattern.test(prompt)) return taskType
  }
  return 'default'
}

function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4)
}

const DOC_TRIGGER_PATTERNS = [
  /\b(react|vue|angular|svelte|next|nuxt|fastify|express|koa|hono)\b/i,
  /\b(postgres|mysql|redis|mongo|sqlite|supabase|prisma|drizzle)\b/i,
  /\b(playwright|jest|vitest|cypress|mocha|bun:test)\b/i,
  /\b(tailwind|shadcn|radix|chakra|material.?ui)\b/i,
  /\b(zod|yup|joi|ajv)\b/i,
  /\b(docker|kubernetes|nginx|caddy)\b/i,
  /\b(aws|gcp|azure|cloudflare|vercel)\b/i,
]

function needsDocs(prompt: string): boolean {
  return DOC_TRIGGER_PATTERNS.some(p => p.test(prompt))
}

export function classifyTask(
  prompt: string,
  options: {
    agentName?: string
    subagentType?: string
    contextTokens?: number
    escalationRules?: EscalationRule[]
  } = {},
): ClassifierResult {
  const taskType = detectTaskType(prompt, options.agentName, options.subagentType)
  const initialTier = TASK_TYPE_TIERS[taskType] ?? 'T1'
  const escalations: string[] = []
  let finalTier = initialTier

  const escalation = checkEscalation(prompt, options.escalationRules)
  if (escalation.escalated && escalation.minTier) {
    const tierRank: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 }
    if (tierRank[escalation.minTier] > tierRank[finalTier]) {
      finalTier = escalation.minTier
      escalations.push(...escalation.reasons)
    }
  }

  const estTokens = options.contextTokens ?? estimateTokens(prompt)
  if (estTokens > 128000) {
    const tierRank: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 }
    if (tierRank['T3'] > tierRank[finalTier]) {
      finalTier = 'T3'
      escalations.push('context_size_exceeds_128K')
    }
  } else if (estTokens > 32000 && finalTier === 'T0') {
    finalTier = 'T1'
    escalations.push('context_size_exceeds_32K')
  }

  const reasons = [
    `task_type=${taskType}`,
    `initial=${initialTier}`,
    ...escalations.map(e => `escalation=${e}`),
  ].join(', ')

  return { initialTier, finalTier, reason: reasons, docNeeded: needsDocs(prompt), estimatedTokens: estTokens, escalations }
}
