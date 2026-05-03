/**
 * Detecta complexidade de tasks baseado em heurísticas.
 * Usado para auto-spawn de Plan/Review agents em background.
 */

export interface ComplexityAnalysis {
  needsPlanning: boolean
  needsReview: boolean
  confidence: number // 0-1
  reasons: string[]
}

const PLANNING_KEYWORDS = [
  'implement',
  'add feature',
  'create',
  'build',
  'refactor',
  'migrate',
  'redesign',
  'architecture',
  'system',
  'integrate',
  'port',
  'alternative',
]

const REVIEW_KEYWORDS = [
  'review',
  'audit',
  'check',
  'verify',
  'security',
  'vulnerability',
  'bug',
  'issue',
  'problem',
  'fix',
]

const COMPLEXITY_INDICATORS = [
  'multiple',
  'all',
  'entire',
  'across',
  'comprehensive',
  'complete',
  'full',
]

const SCOPE_INDICATORS = [
  'codebase',
  'project',
  'repository',
  'system',
  'application',
  'service',
]

/**
 * Analisa prompt do usuário e determina se precisa de planning/review automático.
 */
export function analyzeTaskComplexity(userPrompt: string): ComplexityAnalysis {
  const lower = userPrompt.toLowerCase()
  const reasons: string[] = []
  let needsPlanning = false
  let needsReview = false
  let confidence = 0

  // Check planning keywords
  const planningMatches = PLANNING_KEYWORDS.filter(kw => lower.includes(kw))
  if (planningMatches.length > 0) {
    needsPlanning = true
    confidence += 0.3
    reasons.push(`Planning keywords: ${planningMatches.join(', ')}`)
  }

  // Check review keywords
  const reviewMatches = REVIEW_KEYWORDS.filter(kw => lower.includes(kw))
  if (reviewMatches.length > 0) {
    needsReview = true
    confidence += 0.3
    reasons.push(`Review keywords: ${reviewMatches.join(', ')}`)
  }

  // Check complexity indicators
  const complexityMatches = COMPLEXITY_INDICATORS.filter(kw =>
    lower.includes(kw),
  )
  if (complexityMatches.length > 0) {
    confidence += 0.2
    reasons.push(`Complexity indicators: ${complexityMatches.join(', ')}`)
  }

  // Check scope indicators
  const scopeMatches = SCOPE_INDICATORS.filter(kw => lower.includes(kw))
  if (scopeMatches.length > 0) {
    confidence += 0.2
    reasons.push(`Large scope: ${scopeMatches.join(', ')}`)
  }

  // Multi-file indicators
  if (lower.match(/\d+\+?\s*(files?|modules?|components?)/)) {
    confidence += 0.3
    reasons.push('Multi-file change mentioned')
  }

  // Long prompt = complex task
  if (userPrompt.length > 200) {
    confidence += 0.1
    reasons.push('Long detailed prompt')
  }

  // Cap confidence at 1.0
  confidence = Math.min(confidence, 1.0)

  return {
    needsPlanning,
    needsReview,
    confidence,
    reasons,
  }
}

/**
 * Determina se deve auto-spawn agent baseado em análise.
 */
export function shouldAutoSpawn(analysis: ComplexityAnalysis): boolean {
  // Só auto-spawn se confiança >= 0.5
  return (
    (analysis.needsPlanning || analysis.needsReview) && analysis.confidence >= 0.5
  )
}
