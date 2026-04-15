import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  writePlan,
  writeDecisionRecord,
  writeExecutionLog,
  writeSummary,
} from './artifacts'
import type {
  PlanArtifact,
  DecisionArtifact,
  ExecutionLogArtifact,
  SummaryArtifact,
} from './artifacts'

describe('vault artifacts', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-artifacts-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const samplePlan: PlanArtifact = {
    title: 'Add authentication layer',
    goal: 'Secure all API endpoints with JWT',
    steps: ['Install jose library', 'Create auth middleware', 'Add route guards'],
    filesAffected: ['src/auth/middleware.ts', 'src/routes/index.ts'],
    risks: ['Token expiry edge cases', 'Performance overhead on every request'],
  }

  const sampleDecision: DecisionArtifact = {
    title: 'Use SQLite over Postgres',
    context: 'Need a database for local storage of vault metadata.',
    decision: 'Use SQLite via better-sqlite3 for zero-config local persistence.',
    tradeoffs: 'Simpler setup but limited concurrent writes.',
    consequences: 'No need for external DB process; migration path to Postgres if needed later.',
  }

  const sampleLog: ExecutionLogArtifact = {
    title: 'Auth layer implementation',
    planReference: '20260412-add-authentication-layer.md',
    stepsCompleted: ['Installed jose', 'Created middleware', 'Added guards'],
    deviations: ['Used cookie-based tokens instead of headers'],
    filesChanged: ['src/auth/middleware.ts', 'src/auth/cookies.ts'],
  }

  const sampleSummary: SummaryArtifact = {
    title: 'Sprint 1 completion',
    whatWasDone: 'Implemented auth layer and vault writer module.',
    whatWasVerified: 'All 15 tests passing. Manual verification of token flow.',
    remainingConcerns: ['Token refresh not yet implemented', 'No rate limiting'],
  }

  describe('writePlan', () => {
    test('creates file in plans/ with correct content', () => {
      const filename = writePlan(tempDir, samplePlan)
      const filePath = join(tempDir, 'plans', filename)

      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('# Plan: Add authentication layer')
      expect(content).toContain('**Goal:** Secure all API endpoints with JWT')
      expect(content).toContain('1. Install jose library')
      expect(content).toContain('2. Create auth middleware')
      expect(content).toContain('3. Add route guards')
      expect(content).toContain('- `src/auth/middleware.ts`')
      expect(content).toContain('- `src/routes/index.ts`')
      expect(content).toContain('## Risks')
      expect(content).toContain('- Token expiry edge cases')
      expect(content).toContain('- Performance overhead on every request')
    })

    test('omits risks section when no risks provided', () => {
      const planNoRisks: PlanArtifact = { ...samplePlan, risks: undefined }
      const filename = writePlan(tempDir, planNoRisks)
      const content = readFileSync(join(tempDir, 'plans', filename), 'utf-8')

      expect(content).not.toContain('## Risks')
    })

    test('omits risks section when risks array is empty', () => {
      const planEmptyRisks: PlanArtifact = { ...samplePlan, risks: [] }
      const filename = writePlan(tempDir, planEmptyRisks)
      const content = readFileSync(join(tempDir, 'plans', filename), 'utf-8')

      expect(content).not.toContain('## Risks')
    })
  })

  describe('writeDecisionRecord', () => {
    test('creates file in decisions/ with ADR format', () => {
      const filename = writeDecisionRecord(tempDir, sampleDecision)
      const filePath = join(tempDir, 'decisions', filename)

      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('# Decision: Use SQLite over Postgres')
      expect(content).toContain('**Status:** Accepted')
      expect(content).toContain('## Context')
      expect(content).toContain('Need a database for local storage')
      expect(content).toContain('## Decision')
      expect(content).toContain('Use SQLite via better-sqlite3')
      expect(content).toContain('## Trade-offs')
      expect(content).toContain('Simpler setup but limited concurrent writes')
      expect(content).toContain('## Consequences')
      expect(content).toContain('No need for external DB process')
    })

    test('includes date in ISO format', () => {
      const filename = writeDecisionRecord(tempDir, sampleDecision)
      const content = readFileSync(join(tempDir, 'decisions', filename), 'utf-8')

      expect(content).toMatch(/\*\*Date:\*\* \d{4}-\d{2}-\d{2}/)
    })
  })

  describe('writeExecutionLog', () => {
    test('creates file in logs/ with steps and deviations', () => {
      const filename = writeExecutionLog(tempDir, sampleLog)
      const filePath = join(tempDir, 'logs', filename)

      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('# Execution Log: Auth layer implementation')
      expect(content).toContain('**Plan:** 20260412-add-authentication-layer.md')
      expect(content).toContain('## Steps Completed')
      expect(content).toContain('1. ✅ Installed jose')
      expect(content).toContain('2. ✅ Created middleware')
      expect(content).toContain('## Deviations')
      expect(content).toContain('- ⚠️ Used cookie-based tokens instead of headers')
      expect(content).toContain('- `src/auth/middleware.ts`')
    })

    test('omits deviations section when no deviations', () => {
      const logNoDeviations: ExecutionLogArtifact = {
        ...sampleLog,
        deviations: undefined,
      }
      const filename = writeExecutionLog(tempDir, logNoDeviations)
      const content = readFileSync(join(tempDir, 'logs', filename), 'utf-8')

      expect(content).not.toContain('## Deviations')
    })

    test('omits plan reference when not provided', () => {
      const logNoPlan: ExecutionLogArtifact = {
        ...sampleLog,
        planReference: undefined,
      }
      const filename = writeExecutionLog(tempDir, logNoPlan)
      const content = readFileSync(join(tempDir, 'logs', filename), 'utf-8')

      expect(content).not.toContain('**Plan:**')
    })
  })

  describe('writeSummary', () => {
    test('creates file in summaries/ with correct sections', () => {
      const filename = writeSummary(tempDir, sampleSummary)
      const filePath = join(tempDir, 'summaries', filename)

      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('# Summary: Sprint 1 completion')
      expect(content).toContain('## What Was Done')
      expect(content).toContain('Implemented auth layer and vault writer module.')
      expect(content).toContain('## What Was Verified')
      expect(content).toContain('All 15 tests passing')
      expect(content).toContain('## Remaining Concerns')
      expect(content).toContain('- Token refresh not yet implemented')
      expect(content).toContain('- No rate limiting')
    })

    test('omits remaining concerns when not provided', () => {
      const summaryNoConcerns: SummaryArtifact = {
        ...sampleSummary,
        remainingConcerns: undefined,
      }
      const filename = writeSummary(tempDir, summaryNoConcerns)
      const content = readFileSync(join(tempDir, 'summaries', filename), 'utf-8')

      expect(content).not.toContain('## Remaining Concerns')
    })
  })

  describe('filename format', () => {
    test('follows {timestamp}-{slug}.md pattern', () => {
      const filename = writePlan(tempDir, samplePlan)

      expect(filename).toMatch(/^\d{8}-\d{6}-[a-z0-9-]+\.md$/)
    })

    test('slug: spaces become hyphens', () => {
      const filename = writePlan(tempDir, {
        ...samplePlan,
        title: 'my great plan',
      })

      expect(filename).toContain('-my-great-plan.md')
    })

    test('slug: special chars removed', () => {
      const filename = writePlan(tempDir, {
        ...samplePlan,
        title: 'Plan: the (final) one!',
      })

      expect(filename).toContain('-plan-the-final-one.md')
    })

    test('slug: max 50 chars', () => {
      const longTitle = 'a'.repeat(100)
      const filename = writePlan(tempDir, {
        ...samplePlan,
        title: longTitle,
      })

      // timestamp is 15 chars (YYYYMMDD-HHmmss), plus dash, plus slug (max 50), plus .md
      const slug = filename.replace(/^\d{8}-\d{6}-/, '').replace(/\.md$/, '')
      expect(slug.length).toBeLessThanOrEqual(50)
    })
  })

  describe('subdirectory creation', () => {
    test('creates plans/ directory automatically', () => {
      const nestedVault = join(tempDir, 'deep', 'vault')
      writePlan(nestedVault, samplePlan)

      expect(existsSync(join(nestedVault, 'plans'))).toBe(true)
    })

    test('creates decisions/ directory automatically', () => {
      writeDecisionRecord(tempDir, sampleDecision)

      expect(existsSync(join(tempDir, 'decisions'))).toBe(true)
    })

    test('creates logs/ directory automatically', () => {
      writeExecutionLog(tempDir, sampleLog)

      expect(existsSync(join(tempDir, 'logs'))).toBe(true)
    })

    test('creates summaries/ directory automatically', () => {
      writeSummary(tempDir, sampleSummary)

      expect(existsSync(join(tempDir, 'summaries'))).toBe(true)
    })
  })

  describe('bridge-ai marker', () => {
    test('all artifact types contain bridge-ai generated marker', () => {
      const planFile = writePlan(tempDir, samplePlan)
      const decisionFile = writeDecisionRecord(tempDir, sampleDecision)
      const logFile = writeExecutionLog(tempDir, sampleLog)
      const summaryFile = writeSummary(tempDir, sampleSummary)

      const marker = '<!-- bridge-ai generated -->'

      expect(readFileSync(join(tempDir, 'plans', planFile), 'utf-8')).toContain(marker)
      expect(readFileSync(join(tempDir, 'decisions', decisionFile), 'utf-8')).toContain(marker)
      expect(readFileSync(join(tempDir, 'logs', logFile), 'utf-8')).toContain(marker)
      expect(readFileSync(join(tempDir, 'summaries', summaryFile), 'utf-8')).toContain(marker)
    })
  })
})
