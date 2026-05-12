import { describe, it, expect } from 'bun:test'
import { DEPENDENCY_AUDIT_TOOL_NAME } from './prompt.js'
import { DependencyAuditTool } from './DependencyAuditTool.js'

describe('DependencyAuditTool', () => {
  it('has the correct name', () => {
    expect(DependencyAuditTool.name).toBe(DEPENDENCY_AUDIT_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await DependencyAuditTool.description()).length).toBeGreaterThan(0)
  })

  it('is always read-only', () => {
    expect(DependencyAuditTool.isReadOnly?.()).toBe(true)
  })

  it('accepts valid input', async () => {
    expect((await DependencyAuditTool.validateInput({ manager: 'npm' })).result).toBe(true)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = DependencyAuditTool.mapToolResultToToolResultBlockParam({ success: true, manager: 'npm', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: 50 }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = DependencyAuditTool.renderToolUseMessage?.({ manager: 'npm', severity: 'high' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('npm')
  })

  it('renders no vulnerabilities', () => {
    const msg = DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'npm', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: 500 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('No vulnerabilities found')
  })

  it('renders vulnerabilities found', () => {
    const msg = DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'npm', total: 3, bySeverity: { critical: 1, high: 2, medium: 0, low: 0 }, advisories: [
      { package: 'lodash', severity: 'critical', title: 'Proto Pollution' },
      { package: 'express', severity: 'high', title: 'XSS' },
      { package: 'axios', severity: 'high', title: 'SSRF' },
    ], durationMs: 800 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) {
      expect(msg.text).toContain('3 vulnerabilities')
      expect(msg.text).toContain('1 critical')
      expect(msg.text).toContain('2 high')
    }
  })

  it('renders error result', () => {
    const msg = DependencyAuditTool.renderToolResultMessage?.({ success: false, manager: 'npm', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: 50, error: 'npm audit failed' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('npm audit failed')
  })

  it('provides auto-classifier input', () => {
    expect(DependencyAuditTool.toAutoClassifierInput?.({ manager: 'cargo', severity: 'critical' })).toContain('cargo audit')
  })

  it('parses npm audit JSON correctly', () => {
    const msg = DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'npm', total: 2, bySeverity: { critical: 1, high: 0, medium: 1, low: 0 }, advisories: [
      { package: 'lodash', severity: 'critical', title: 'Proto Pollution', patchedIn: '>=4.17.21' },
      { package: 'axios', severity: 'medium', title: 'SSRF', patchedIn: '>=1.6.0' },
    ], durationMs: 300 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) {
      expect(msg.text).toContain('2 vulnerabilities')
      expect(msg.text).toContain('1 critical')
    }
  })
})
