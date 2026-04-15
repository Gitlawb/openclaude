import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  formatForClaude,
  formatForCursor,
  formatForGemini,
  formatForProvider,
} from './formatters'

describe('formatters', () => {
  let tempDir: string
  let vaultPath: string
  let projectRoot: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'formatters-test-'))
    projectRoot = tempDir
    vaultPath = join(tempDir, '.bridgeai', 'vault')
    mkdirSync(vaultPath, { recursive: true })

    // Create sample vault docs
    writeFileSync(join(vaultPath, 'overview.md'), '## Overview\n\nThis is a test project.')
    writeFileSync(join(vaultPath, 'stack.md'), '## Stack\n\n- TypeScript\n- Bun')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('formatForClaude', () => {
    test('creates CLAUDE.md in vault path with marker', () => {
      const result = formatForClaude(vaultPath, projectRoot)

      expect(result.skipped).toBe(false)
      expect(result.filePath).toBe(join(vaultPath, 'CLAUDE.md'))
      expect(existsSync(result.filePath)).toBe(true)

      const content = readFileSync(result.filePath, 'utf-8')
      expect(content).toContain('<!-- bridge-ai generated -->')
      expect(content).toContain('# Project Instructions')
    })

    test('includes vault doc content', () => {
      formatForClaude(vaultPath, projectRoot)

      const content = readFileSync(join(vaultPath, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('This is a test project.')
      expect(content).toContain('TypeScript')
    })
  })

  describe('formatForCursor', () => {
    test('creates .cursorrules at project root with marker', () => {
      const result = formatForCursor(vaultPath, projectRoot)

      expect(result.skipped).toBe(false)
      expect(result.filePath).toBe(join(projectRoot, '.cursorrules'))
      expect(existsSync(result.filePath)).toBe(true)

      const content = readFileSync(result.filePath, 'utf-8')
      expect(content).toContain('<!-- bridge-ai generated -->')
    })

    test('skips if existing .cursorrules without bridge-ai marker', () => {
      const cursorrules = join(projectRoot, '.cursorrules')
      writeFileSync(cursorrules, 'Custom rules written by user')

      const result = formatForCursor(vaultPath, projectRoot)

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('skipped to avoid overwriting')

      // Original content preserved
      const content = readFileSync(cursorrules, 'utf-8')
      expect(content).toBe('Custom rules written by user')
    })

    test('overwrites existing .cursorrules with bridge-ai marker', () => {
      const cursorrules = join(projectRoot, '.cursorrules')
      writeFileSync(cursorrules, '<!-- bridge-ai generated -->\nOld content')

      const result = formatForCursor(vaultPath, projectRoot)

      expect(result.skipped).toBe(false)

      const content = readFileSync(cursorrules, 'utf-8')
      expect(content).toContain('# Project Instructions')
    })
  })

  describe('formatForGemini', () => {
    test('creates .gemini/rules.md with marker', () => {
      const result = formatForGemini(vaultPath, projectRoot)

      expect(result.skipped).toBe(false)
      expect(result.filePath).toBe(join(projectRoot, '.gemini', 'rules.md'))
      expect(existsSync(result.filePath)).toBe(true)

      const content = readFileSync(result.filePath, 'utf-8')
      expect(content).toContain('<!-- bridge-ai generated -->')
    })

    test('skips if existing .gemini/rules.md without bridge-ai marker', () => {
      const geminiDir = join(projectRoot, '.gemini')
      mkdirSync(geminiDir, { recursive: true })
      writeFileSync(join(geminiDir, 'rules.md'), 'User custom gemini rules')

      const result = formatForGemini(vaultPath, projectRoot)

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('skipped')
    })
  })

  describe('formatForProvider', () => {
    test('dispatches to claude formatter', () => {
      const result = formatForProvider('claude', vaultPath, projectRoot)
      expect(result.filePath).toBe(join(vaultPath, 'CLAUDE.md'))
      expect(result.skipped).toBe(false)
    })

    test('dispatches to cursor formatter', () => {
      const result = formatForProvider('cursor', vaultPath, projectRoot)
      expect(result.filePath).toBe(join(projectRoot, '.cursorrules'))
      expect(result.skipped).toBe(false)
    })

    test('dispatches to gemini formatter', () => {
      const result = formatForProvider('gemini', vaultPath, projectRoot)
      expect(result.filePath).toBe(join(projectRoot, '.gemini', 'rules.md'))
      expect(result.skipped).toBe(false)
    })

    test('generic falls back to claude formatter', () => {
      const result = formatForProvider('generic', vaultPath, projectRoot)
      expect(result.filePath).toBe(join(vaultPath, 'CLAUDE.md'))
      expect(result.skipped).toBe(false)
    })
  })

  describe('content building', () => {
    test('includes auto-generation notice', () => {
      formatForClaude(vaultPath, projectRoot)

      const content = readFileSync(join(vaultPath, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('Auto-generated by bridge-ai')
      expect(content).toContain('Re-run `/onboard` to regenerate')
    })

    test('includes content from vault docs that exist', () => {
      formatForClaude(vaultPath, projectRoot)

      const content = readFileSync(join(vaultPath, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('## Overview')
      expect(content).toContain('This is a test project.')
      expect(content).toContain('## Stack')
      expect(content).toContain('TypeScript')
    })

    test('skips vault docs that do not exist', () => {
      formatForClaude(vaultPath, projectRoot)

      const content = readFileSync(join(vaultPath, 'CLAUDE.md'), 'utf-8')
      // architecture.md, conventions.md, testing.md, commands.md don't exist
      // so their content should not appear
      expect(content).not.toContain('architecture')
      expect(content).not.toContain('conventions')
    })
  })
})
