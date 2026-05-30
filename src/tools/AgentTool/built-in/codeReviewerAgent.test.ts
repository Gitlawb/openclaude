import { beforeAll, describe, expect, test } from 'bun:test'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '../loadAgentsDir.js'
import { loadMarkdownFilesForSubdir } from '../../../utils/markdownConfigLoader.js'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'
import type { ToolUseContext } from '../../../Tool.js'

describe('code-reviewer built-in agent', () => {
  let agent: BuiltInAgentDefinition

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-reviewer-test-'))
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = join(dir, '.openclaude')
    clearAgentDefinitionsCache()
    loadMarkdownFilesForSubdir.cache.clear?.()

    try {
      const { activeAgents } = await getAgentDefinitionsWithOverrides(dir)
      const found = activeAgents.find(a => a.agentType === 'code-reviewer')
      if (!found || found.source !== 'built-in') {
        throw new Error('code-reviewer agent not found in built-in agents')
      }
      agent = found as BuiltInAgentDefinition
    } finally {
      // Restore env regardless of outcome so other test files are not affected
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      await rm(dir, { recursive: true, force: true })
    }
  })

  // ── Definition ────────────────────────────────────────────────

  test('source is built-in', () => {
    expect(agent.source).toBe('built-in')
  })

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
    expect(disallowed).toContain('Bash')
    expect(disallowed).toContain('Edit')
    expect(disallowed).toContain('Write')
    expect(disallowed).toContain('NotebookEdit')
    expect(disallowed).toContain('ExitPlanMode')
  })

  // ── System prompt ─────────────────────────────────────────────

  describe('system prompt', () => {
    let prompt: string

    beforeAll(() => {
      prompt = agent.getSystemPrompt({
        toolUseContext: {} as Pick<ToolUseContext, 'options'>,
      })
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
