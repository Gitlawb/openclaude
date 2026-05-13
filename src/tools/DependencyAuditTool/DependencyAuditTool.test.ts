import { describe, it, expect } from 'bun:test'
import { DEPENDENCY_AUDIT_TOOL_NAME } from './prompt.js'
import { DependencyAuditTool } from './DependencyAuditTool.js'

describe('DependencyAuditTool', () => {
  it('has the correct name', () => { expect(DependencyAuditTool.name).toBe(DEPENDENCY_AUDIT_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await DependencyAuditTool.description()).length).toBeGreaterThan(0) })
  it('is not read-only (runs network commands)', () => { expect(DependencyAuditTool.isReadOnly?.()).toBe(false) })
  it('accepts valid input', async () => { expect((await DependencyAuditTool.validateInput({ manager: 'npm' })).result).toBe(true) })
  it('has checkPermissions defined', () => { expect(typeof DependencyAuditTool.checkPermissions).toBe('function') })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = DependencyAuditTool.mapToolResultToToolResultBlockParam({ success: true, manager: 'npm', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: 50 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })

  it('renders tool use message', () => { expect(DependencyAuditTool.renderToolUseMessage?.({ manager: 'npm', severity: 'high' })).toContain('npm') })
  it('renders no vulnerabilities', () => { expect(DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'npm', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: 500 })).toContain('No vulnerabilities found') })
  it('renders vulnerabilities found', () => {
    const m = DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'npm', total: 3, bySeverity: { critical: 1, high: 2, medium: 0, low: 0 }, advisories: [
      { package: 'lodash', severity: 'critical', title: 'Proto Pollution' },
      { package: 'express', severity: 'high', title: 'XSS' },
      { package: 'axios', severity: 'high', title: 'SSRF' },
    ], durationMs: 800 })
    expect(m).toContain('3 vulnerabilities'); expect(m).toContain('1 critical'); expect(m).toContain('2 high')
  })
  it('renders error result', () => { expect(DependencyAuditTool.renderToolResultMessage?.({ success: false, manager: 'npm', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: 50, error: 'npm audit failed' })).toContain('npm audit failed') })
  it('provides auto-classifier input', () => { expect(DependencyAuditTool.toAutoClassifierInput?.({ manager: 'cargo', severity: 'critical' })).toContain('cargo audit') })
  it('parses npm audit JSON correctly', () => {
    expect(DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'npm', total: 2, bySeverity: { critical: 1, high: 0, medium: 1, low: 0 }, advisories: [
      { package: 'lodash', severity: 'critical', title: 'Proto Pollution', patchedIn: '>=4.17.21' },
      { package: 'axios', severity: 'medium', title: 'SSRF', patchedIn: '>=1.6.0' },
    ], durationMs: 300 })).toContain('2 vulnerabilities')
  })
  it('parses pip-audit format via rendering', () => {
    expect(DependencyAuditTool.renderToolResultMessage?.({ success: true, manager: 'pip', total: 2, bySeverity: { critical: 1, high: 1, medium: 0, low: 0 }, advisories: [
      { package: 'requests', severity: 'high', title: 'HTTP request smuggling', patchedIn: '2.31.0' },
      { package: 'flask', severity: 'critical', title: 'SSTI vulnerability', patchedIn: '2.3.0' },
    ], durationMs: 400 })).toContain('2 vulnerabilities')
  })
})
