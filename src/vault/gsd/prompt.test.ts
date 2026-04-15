import { describe, test, expect } from 'bun:test'
import { getGSDLifecyclePrompt } from './prompt.js'

describe('getGSDLifecyclePrompt', () => {
  test('returns prompt containing triage categories', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('Request Triage')
    expect(prompt).toContain('**Casual**')
    expect(prompt).toContain('**Quick**')
    expect(prompt).toContain('**Full Lifecycle**')
  })

  test('returns prompt containing all lifecycle phases', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('### 1. Discuss')
    expect(prompt).toContain('### 2. Research')
    expect(prompt).toContain('### 3. Plan')
    expect(prompt).toContain('### 4. Execute')
    expect(prompt).toContain('### 5. Verify')
  })

  test('contains STATE.md references', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('STATE.md')
    expect(prompt).toContain('## Recent Decisions')
    expect(prompt).toContain('## Active Blockers')
    expect(prompt).toContain('## Lessons Learned')
  })

  test('contains vault recording rules with artifact paths', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('vault/plans/')
    expect(prompt).toContain('vault/logs/')
    expect(prompt).toContain('vault/summaries/')
    expect(prompt).toContain('vault/decisions/')
  })

  test('contains enduring doc paths', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('vault/stack.md')
    expect(prompt).toContain('vault/architecture.md')
    expect(prompt).toContain('vault/conventions.md')
    expect(prompt).toContain('vault/testing.md')
    expect(prompt).toContain('vault/commands.md')
  })

  test('contains session-end behavior section', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('Session-End Behavior')
    expect(prompt).toContain('ensure STATE.md reflects')
  })

  test('contains "just do it" override rule', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('just do it')
    expect(prompt).toContain('skip directly to execution')
  })

  test('contains max 3 verify attempts guard', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('Max 3 verify attempts')
  })

  test('includes state context when provided', () => {
    const stateContext = '## Current Work\nImplementing auth module\n\n## Recent Decisions\n- Use JWT tokens'
    const prompt = getGSDLifecyclePrompt(stateContext)
    expect(prompt).toContain('## Current Project State')
    expect(prompt).toContain('Implementing auth module')
    expect(prompt).toContain('Use JWT tokens')
  })

  test('does NOT include state section when no context provided', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).not.toContain('Current Project State')
  })

  test('contains workspace isolation section with worktree instructions', () => {
    const prompt = getGSDLifecyclePrompt()
    expect(prompt).toContain('Workspace Isolation')
    expect(prompt).toContain('EnterWorktree')
    expect(prompt).toContain('ExitWorktree')
    expect(prompt).toContain('worktree')
    expect(prompt).toContain('promote')
    expect(prompt).toContain('abandon')
  })

  test('prompt is under 5500 words', () => {
    const prompt = getGSDLifecyclePrompt()
    const wordCount = prompt.split(/\s+/).filter(Boolean).length
    expect(wordCount).toBeLessThan(5500)
  })
})
