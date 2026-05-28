import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '../loadAgentsDir.js'
import { loadMarkdownFilesForSubdir } from '../../../utils/markdownConfigLoader.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

let tempDir: string

beforeEach(async () => {
  await acquireSharedMutationLock('codeReviewerAgent.test.ts')
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-reviewer-test-'))
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, '.openclaude')
  clearAgentDefinitionsCache()
  loadMarkdownFilesForSubdir.cache.clear?.()
})

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
    clearAgentDefinitionsCache()
    loadMarkdownFilesForSubdir.cache.clear?.()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('code-reviewer built-in agent', () => {
  let agent: BuiltInAgentDefinition

  beforeAll(async () => {
    // Must use tempDir after beforeEach sets it — but beforeAll runs before beforeEach.
    // Use a temp dir directly here.
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-reviewer-all-'))
    process.env.CLAUDE_CONFIG_DIR = join(dir, '.openclaude')
    clearAgentDefinitionsCache()
    loadMarkdownFilesForSubdir.cache.clear?.()

    const { activeAgents } = await getAgentDefinitionsWithOverrides(dir)
    const found = activeAgents.find(a => a.agentType === 'code-reviewer')
    if (!found || found.source !== 'built-in') {
      throw new Error('code-reviewer agent not found in built-in agents')
    }
    agent = found as BuiltInAgentDefinition
    await rm(dir, { recursive: true, force: true })
  })

  // ── Registration ──────────────────────────────────────────────

  test('is registered in built-in agents', () => {
    expect(agent).toBeDefined()
  })

  test('source is built-in', () => {
    expect(agent.source).toBe('built-in')
  })

  // ── Definition ────────────────────────────────────────────────

  test('model is inherit (allows agentRouting override)', () => {
    expect(agent.model).toBe('inherit')
  })

  test('omitClaudeMd is true', () => {
    expect(agent.omitClaudeMd).toBe(true)
  })

  test('whenToUse is non-empty', () => {
    expect(agent.whenToUse.length).toBeGreaterThan(0)
  })

  test('disallows mutation tools', () => {
    const disallowed = agent.disallowedTools ?? []
    expect(disallowed).toContain('Agent')
    expect(disallowed).toContain('Edit')
    expect(disallowed).toContain('Write')
    expect(disallowed).toContain('NotebookEdit')
    expect(disallowed).toContain('ExitPlanMode')
  })

  // ── System prompt ─────────────────────────────────────────────

  describe('system prompt', () => {
    let prompt: string

    beforeAll(() => {
      // @ts-ignore — toolUseContext unused by this agent
      prompt = agent.getSystemPrompt({})
    })

    test('returns non-empty string', () => {
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(0)
    })

    test('covers all review dimensions', () => {
      expect(prompt).toContain('Correctness')
      expect(prompt).toContain('Security')
      expect(prompt).toContain('Performance')
      expect(prompt).toContain('Maintainability')
      expect(prompt).toContain('Design')
    })

    test('defines severity levels', () => {
      expect(prompt).toContain('CRITICAL')
      expect(prompt).toContain('HIGH')
      expect(prompt).toContain('MEDIUM')
      expect(prompt).toContain('LOW')
    })

    test('enforces read-only constraint', () => {
      expect(prompt).toContain('READ-ONLY')
    })

    test('includes verdict in output format', () => {
      expect(prompt).toContain('Verdict')
    })
  })
})
