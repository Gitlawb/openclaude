import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Generate a URL-safe slug from a title.
 * Lowercase, replace non-alphanumeric with hyphens, max 50 chars, trim trailing hyphens.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
}

/**
 * Generate timestamp prefix: YYYYMMDD-HHmmss
 */
function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export type PlanArtifact = {
  title: string
  goal: string
  steps: string[]
  filesAffected: string[]
  risks?: string[]
}

export type DecisionArtifact = {
  title: string
  context: string
  decision: string
  tradeoffs: string
  consequences: string
}

export type ExecutionLogArtifact = {
  title: string
  planReference?: string
  stepsCompleted: string[]
  deviations?: string[]
  filesChanged: string[]
}

export type SummaryArtifact = {
  title: string
  whatWasDone: string
  whatWasVerified: string
  remainingConcerns?: string[]
}

export function writePlan(vaultPath: string, plan: PlanArtifact): string {
  const filename = `${timestamp()}-${slugify(plan.title)}.md`
  const dir = join(vaultPath, 'plans')
  mkdirSync(dir, { recursive: true })

  const content = [
    `# Plan: ${plan.title}`,
    '',
    `<!-- bridge-ai generated -->`,
    '',
    `**Goal:** ${plan.goal}`,
    '',
    '## Steps',
    '',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Files Affected',
    '',
    ...plan.filesAffected.map(f => `- \`${f}\``),
    ...(plan.risks?.length ? ['', '## Risks', '', ...plan.risks.map(r => `- ${r}`)] : []),
    '',
  ].join('\n')

  writeFileSync(join(dir, filename), content, 'utf-8')
  return filename
}

export function writeDecisionRecord(vaultPath: string, decision: DecisionArtifact): string {
  const filename = `${timestamp()}-${slugify(decision.title)}.md`
  const dir = join(vaultPath, 'decisions')
  mkdirSync(dir, { recursive: true })

  const content = [
    `# Decision: ${decision.title}`,
    '',
    `<!-- bridge-ai generated -->`,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Status:** Accepted`,
    '',
    '## Context',
    '',
    decision.context,
    '',
    '## Decision',
    '',
    decision.decision,
    '',
    '## Trade-offs',
    '',
    decision.tradeoffs,
    '',
    '## Consequences',
    '',
    decision.consequences,
    '',
  ].join('\n')

  writeFileSync(join(dir, filename), content, 'utf-8')
  return filename
}

export function writeExecutionLog(vaultPath: string, log: ExecutionLogArtifact): string {
  const filename = `${timestamp()}-${slugify(log.title)}.md`
  const dir = join(vaultPath, 'logs')
  mkdirSync(dir, { recursive: true })

  const content = [
    `# Execution Log: ${log.title}`,
    '',
    `<!-- bridge-ai generated -->`,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    ...(log.planReference ? [`**Plan:** ${log.planReference}`] : []),
    '',
    '## Steps Completed',
    '',
    ...log.stepsCompleted.map((s, i) => `${i + 1}. ✅ ${s}`),
    ...(log.deviations?.length ? ['', '## Deviations', '', ...log.deviations.map(d => `- ⚠️ ${d}`)] : []),
    '',
    '## Files Changed',
    '',
    ...log.filesChanged.map(f => `- \`${f}\``),
    '',
  ].join('\n')

  writeFileSync(join(dir, filename), content, 'utf-8')
  return filename
}

export function writeSummary(vaultPath: string, summary: SummaryArtifact): string {
  const filename = `${timestamp()}-${slugify(summary.title)}.md`
  const dir = join(vaultPath, 'summaries')
  mkdirSync(dir, { recursive: true })

  const content = [
    `# Summary: ${summary.title}`,
    '',
    `<!-- bridge-ai generated -->`,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## What Was Done',
    '',
    summary.whatWasDone,
    '',
    '## What Was Verified',
    '',
    summary.whatWasVerified,
    ...(summary.remainingConcerns?.length ? ['', '## Remaining Concerns', '', ...summary.remainingConcerns.map(c => `- ${c}`)] : []),
    '',
  ].join('\n')

  writeFileSync(join(dir, filename), content, 'utf-8')
  return filename
}
