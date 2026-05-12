import { describe, it, expect } from 'bun:test'
import { NETWORK_DIAGNOSTIC_TOOL_NAME } from './prompt.js'
import { NetworkDiagnosticTool } from './NetworkDiagnosticTool.js'

describe('NetworkDiagnosticTool', () => {
  it('has the correct name', () => {
    expect(NetworkDiagnosticTool.name).toBe(NETWORK_DIAGNOSTIC_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await NetworkDiagnosticTool.description()).length).toBeGreaterThan(0)
  })

  it('is always read-only', () => {
    expect(NetworkDiagnosticTool.isReadOnly?.()).toBe(true)
  })

  it('accepts valid ping input', async () => {
    expect((await NetworkDiagnosticTool.validateInput({ action: 'ping', target: 'example.com' })).result).toBe(true)
  })

  it('rejects missing target', async () => {
    expect((await NetworkDiagnosticTool.validateInput({ action: 'ping' } as any)).result).toBe(false)
  })

  it('requires port for port-check', async () => {
    expect((await NetworkDiagnosticTool.validateInput({ action: 'port-check', target: 'example.com' })).result).toBe(false)
  })

  it('rejects invalid characters in target', async () => {
    expect((await NetworkDiagnosticTool.validateInput({ action: 'ping', target: 'example.com; rm -rf /' })).result).toBe(false)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = NetworkDiagnosticTool.mapToolResultToToolResultBlockParam({ success: true, action: 'ping', target: 'x.com', output: '', durationMs: 50 }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = NetworkDiagnosticTool.renderToolUseMessage?.({ action: 'ping', target: 'example.com' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toBe('ping example.com')
  })

  it('renders success result', () => {
    const msg = NetworkDiagnosticTool.renderToolResultMessage?.({ success: true, action: 'ping', target: 'example.com', output: '64 bytes', durationMs: 500 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('completed')
  })

  it('renders error result', () => {
    const msg = NetworkDiagnosticTool.renderToolResultMessage?.({ success: false, action: 'dns', target: 'bad.host', output: '', durationMs: 5, error: 'unknown host' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('unknown host')
  })

  it('provides auto-classifier input', () => {
    expect(NetworkDiagnosticTool.toAutoClassifierInput?.({ action: 'ssl-cert', target: 'example.com', port: 443 })).toBe('ssl-cert example.com:443')
  })
})
