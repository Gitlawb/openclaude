/**
 * Local Review System - Alternativa ao Ultrareview do Claude Code.
 * Spawna múltiplos agents paralelos para review abrangente.
 */

import { randomUUID } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from './debug.js'

export interface ReviewTarget {
  type: 'branch' | 'pr' | 'files'
  value: string // branch name, PR number, ou file paths
}

export interface ReviewFinding {
  category: 'security' | 'performance' | 'bug' | 'quality'
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  location?: string // file:line
  suggestion?: string
  confidence: number // 0-1
}

export interface ReviewReport {
  id: string
  target: ReviewTarget
  timestamp: string
  findings: ReviewFinding[]
  critiquePassed: ReviewFinding[] // Findings que passaram adversarial critique
  critiqueRejected: ReviewFinding[] // Findings rejeitados
  summary: string
  reportPath: string
}

const REVIEW_AGENTS = [
  {
    type: 'security-review',
    focus: 'Security vulnerabilities, injection attacks, auth issues',
  },
  {
    type: 'performance-review',
    focus: 'Performance bottlenecks, memory leaks, inefficient algorithms',
  },
  {
    type: 'bug-hunter',
    focus: 'Logic errors, edge cases, race conditions, null pointer issues',
  },
  {
    type: 'code-quality',
    focus: 'Code smells, maintainability, readability, best practices',
  },
] as const

/**
 * Executa review local completo com múltiplos agents.
 */
export async function runLocalReview(
  target: ReviewTarget,
): Promise<ReviewReport> {
  const reviewId = randomUUID()
  const timestamp = new Date().toISOString()

  logForDebugging(`[LocalReview] Starting review ${reviewId} for ${target.type}:${target.value}`)

  // 1. Spawn agents paralelos (limitado por CPU)
  const agentPromises = REVIEW_AGENTS.map((agent) =>
    spawnReviewAgent(reviewId, target, agent.type, agent.focus),
  )

  const agentFindings = await Promise.all(agentPromises)
  const allFindings = agentFindings.flat()

  logForDebugging(`[LocalReview] Collected ${allFindings.length} findings from ${REVIEW_AGENTS.length} agents`)

  // 2. Adversarial critique - filtra false positives
  const { passed, rejected } = await adversarialCritique(allFindings)

  logForDebugging(`[LocalReview] Critique: ${passed.length} passed, ${rejected.length} rejected`)

  // 3. Gerar summary
  const summary = generateSummary(passed)

  // 4. Salvar report
  const reportPath = await saveReport(reviewId, {
    id: reviewId,
    target,
    timestamp,
    findings: allFindings,
    critiquePassed: passed,
    critiqueRejected: rejected,
    summary,
    reportPath: '', // será preenchido
  })

  return {
    id: reviewId,
    target,
    timestamp,
    findings: allFindings,
    critiquePassed: passed,
    critiqueRejected: rejected,
    summary,
    reportPath,
  }
}

/**
 * Spawna agent individual para review.
 */
async function spawnReviewAgent(
  reviewId: string,
  target: ReviewTarget,
  agentType: string,
  focus: string,
): Promise<ReviewFinding[]> {
  logForDebugging(`[LocalReview] Spawning ${agentType} agent`)

  // TODO: Integrar com Agent tool
  // Por enquanto retorna mock findings
  // Implementação real precisa:
  // 1. Chamar Agent tool com subagent_type apropriado
  // 2. Passar target e focus no prompt
  // 3. Parsear output para extrair findings
  // 4. Retornar array de ReviewFinding

  return []
}

/**
 * Adversarial critique - valida findings e filtra false positives.
 */
async function adversarialCritique(findings: ReviewFinding[]): Promise<{
  passed: ReviewFinding[]
  rejected: ReviewFinding[]
}> {
  logForDebugging(`[LocalReview] Running adversarial critique on ${findings.length} findings`)

  // TODO: Integrar com Agent tool
  // Por enquanto aceita todos findings com confidence >= 0.6
  // Implementação real precisa:
  // 1. Spawn critique agent
  // 2. Para cada finding, pedir validação
  // 3. Critique agent tenta refutar finding
  // 4. Se não conseguir refutar, finding passa
  // 5. Se refutar com sucesso, finding é rejeitado

  const passed = findings.filter((f) => f.confidence >= 0.6)
  const rejected = findings.filter((f) => f.confidence < 0.6)

  return { passed, rejected }
}

/**
 * Gera summary do review.
 */
function generateSummary(findings: ReviewFinding[]): string {
  const bySeverity = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    info: findings.filter((f) => f.severity === 'info').length,
  }

  const byCategory = {
    security: findings.filter((f) => f.category === 'security').length,
    performance: findings.filter((f) => f.category === 'performance').length,
    bug: findings.filter((f) => f.category === 'bug').length,
    quality: findings.filter((f) => f.category === 'quality').length,
  }

  return `Review completed with ${findings.length} verified findings:
- Critical: ${bySeverity.critical}
- High: ${bySeverity.high}
- Medium: ${bySeverity.medium}
- Low: ${bySeverity.low}
- Info: ${bySeverity.info}

By category:
- Security: ${byCategory.security}
- Performance: ${byCategory.performance}
- Bugs: ${byCategory.bug}
- Code Quality: ${byCategory.quality}`
}

/**
 * Salva report em markdown.
 */
async function saveReport(
  reviewId: string,
  report: Omit<ReviewReport, 'reportPath'>,
): Promise<string> {
  const reviewsDir = join(homedir(), '.openclaude', 'reviews')
  await mkdir(reviewsDir, { recursive: true })

  const reportPath = join(reviewsDir, `${reviewId}.md`)

  const markdown = `# Code Review Report

**ID:** ${report.id}
**Target:** ${report.target.type} - ${report.target.value}
**Date:** ${report.timestamp}

## Summary

${report.summary}

## Verified Findings (${report.critiquePassed.length})

${report.critiquePassed
  .map(
    (f, i) => `### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}

**Category:** ${f.category}
**Confidence:** ${(f.confidence * 100).toFixed(0)}%
${f.location ? `**Location:** \`${f.location}\`  ` : ''}

${f.description}

${f.suggestion ? `**Suggestion:**\n${f.suggestion}\n` : ''}
---
`,
  )
  .join('\n')}

## Rejected Findings (${report.critiqueRejected.length})

${report.critiqueRejected
  .map(
    (f, i) => `### ${i + 1}. ${f.title}

**Reason:** Failed adversarial critique (confidence: ${(f.confidence * 100).toFixed(0)}%)

---
`,
  )
  .join('\n')}

## All Findings (${report.findings.length})

<details>
<summary>Click to expand</summary>

${report.findings
  .map(
    (f, i) => `### ${i + 1}. [${f.severity}] ${f.title}

**Category:** ${f.category}
**Confidence:** ${(f.confidence * 100).toFixed(0)}%
${f.location ? `**Location:** \`${f.location}\`  ` : ''}

${f.description}

---
`,
  )
  .join('\n')}

</details>
`

  await writeFile(reportPath, markdown, 'utf-8')

  logForDebugging(`[LocalReview] Report saved to ${reportPath}`)

  return reportPath
}
