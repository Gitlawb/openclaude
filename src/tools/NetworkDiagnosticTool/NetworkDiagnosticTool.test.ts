import { describe, it, expect } from 'bun:test'
import { NETWORK_DIAGNOSTIC_TOOL_NAME } from './prompt.js'
import { NetworkDiagnosticTool } from './NetworkDiagnosticTool.js'

describe('NetworkDiagnosticTool', () => {
  it('has the correct name', () => { expect(NetworkDiagnosticTool.name).toBe(NETWORK_DIAGNOSTIC_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await NetworkDiagnosticTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled default from buildTool', () => { expect(NetworkDiagnosticTool.isEnabled()).toBe(true) })
  it('is always read-only', () => { expect(NetworkDiagnosticTool.isReadOnly?.()).toBe(true) })

  it('accepts valid ping', async () => { expect((await NetworkDiagnosticTool.validateInput({ action: 'ping', target: 'example.com' })).result).toBe(true) })
  it('rejects missing target', async () => { expect((await NetworkDiagnosticTool.validateInput({ action: 'ping' } as any)).result).toBe(false) })
  it('requires port for port-check', async () => { expect((await NetworkDiagnosticTool.validateInput({ action: 'port-check', target: 'example.com' })).result).toBe(false) })
  it('rejects invalid chars', async () => { expect((await NetworkDiagnosticTool.validateInput({ action: 'ping', target: 'example.com; rm -rf /' })).result).toBe(false) })

  it('asks permission for execution', async () => {
    const p = await NetworkDiagnosticTool.checkPermissions!({ action: 'ping', target: 'example.com' })
    expect(p.behavior).toBe('ask')
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = NetworkDiagnosticTool.mapToolResultToToolResultBlockParam({ success: true, action: 'ping', target: 'x.com', output: '', durationMs: 50 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })
  it('renders success', () => {
    const m = NetworkDiagnosticTool.renderToolResultMessage?.({ success: true, action: 'ping', target: 'example.com', output: '64 bytes', durationMs: 500 })
    if (m && 'text' in m) expect(m.text).toContain('completed')
  })
  it('renders error', () => {
    const m = NetworkDiagnosticTool.renderToolResultMessage?.({ success: false, action: 'dns', target: 'bad.host', output: '', durationMs: 5, error: 'unknown host' })
    if (m && 'text' in m) expect(m.text).toContain('unknown host')
  })
  it('provides auto-classifier', () => {
    expect(NetworkDiagnosticTool.toAutoClassifierInput?.({ action: 'ssl-cert', target: 'example.com', port: 443 })).toBe('ssl-cert example.com:443')
  })
})
