import { describe, it, expect } from 'bun:test'
import { LINT_TOOL_NAME } from './prompt.js'
import { LintTool } from './LintTool.js'

describe('LintTool', () => {
  it('has the correct name', () => { expect(LintTool.name).toBe(LINT_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await LintTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(LintTool.isEnabled()).toBe(true) })
  it('marks check mode as read-only', () => { expect(LintTool.isReadOnly?.({ fix: false })).toBe(true) })
  it('marks fix mode as destructive', () => { expect(LintTool.isDestructive?.({ fix: true })).toBe(true) })
  it('asks permission for execution', async () => {
    const p = await LintTool.checkPermissions!({ tool: 'eslint', path: 'src/' })
    expect(p.behavior).toBe('ask')
  })
  it('rejects invalid linter', async () => { expect((await LintTool.validateInput({ tool: 'invalid' })).result).toBe(false) })
  it('has mapToolResultToToolResultBlockParam', () => {
    const b = LintTool.mapToolResultToToolResultBlockParam({ success: true, tool: 'eslint', errors: 0, warnings: 0, findings: [], durationMs: 10 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })
  it('renders tool use message', () => { expect(LintTool.renderToolUseMessage?.({ tool: 'eslint', path: 'src/' })).toContain('eslint') })
  it('renders success result', () => { expect(LintTool.renderToolResultMessage?.({ success: true, tool: 'eslint', errors: 2, warnings: 5, findings: [], durationMs: 100 })).toContain('2 errors') })
  it('renders error result', () => { expect(LintTool.renderToolResultMessage?.({ success: false, tool: 'eslint', errors: 0, warnings: 0, findings: [], durationMs: 5, error: 'not found' })).toContain('not found') })
  it('provides auto-classifier input', () => { expect(LintTool.toAutoClassifierInput?.({ tool: 'eslint', path: 'src/' })).toBe('eslint src/') })
})
