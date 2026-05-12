import { describe, it, expect } from 'bun:test'
import { LINT_TOOL_NAME } from './prompt.js'
import { LintTool } from './LintTool.js'

describe('LintTool', () => {
  it('has the correct name', () => {
    expect(LintTool.name).toBe(LINT_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await LintTool.description()).length).toBeGreaterThan(0)
  })

  it('marks fix mode as destructive', () => {
    expect(LintTool.isDestructive?.({ fix: true })).toBe(true)
  })

  it('marks check mode as not destructive', () => {
    expect(LintTool.isDestructive?.({ fix: false })).toBe(false)
  })

  it('asks permission for execution', async () => {
    const perm = await LintTool.checkPermissions!({ tool: 'eslint', path: 'src/' })
    expect(perm.behavior).toBe('ask')
  })

  it('defaults to read-only', () => {
    expect(LintTool.isReadOnly?.({})).toBe(true)
  })

  it('accepts valid linter', async () => {
    expect((await LintTool.validateInput({ tool: 'eslint' })).result).toBe(true)
  })

  it('rejects invalid linter', async () => {
    expect((await LintTool.validateInput({ tool: 'invalid' })).result).toBe(false)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = LintTool.mapToolResultToToolResultBlockParam({ success: true, tool: 'eslint', errors: 0, warnings: 0, findings: [], durationMs: 10 }, 'test-id')
    expect(block.tool_use_id).toBe('test-id')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = LintTool.renderToolUseMessage?.({ tool: 'eslint', path: 'src/' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('eslint')
  })

  it('renders success result', () => {
    const msg = LintTool.renderToolResultMessage?.({ success: true, tool: 'eslint', errors: 2, warnings: 5, findings: [], durationMs: 100 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('2 errors')
  })

  it('renders error result', () => {
    const msg = LintTool.renderToolResultMessage?.({ success: false, tool: 'eslint', errors: 0, warnings: 0, findings: [], durationMs: 5, error: 'not found' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('not found')
  })

  it('provides auto-classifier input', () => {
    expect(LintTool.toAutoClassifierInput?.({ tool: 'eslint', path: 'src/' })).toBe('eslint src/')
  })
})
