import { describe, it, expect } from 'bun:test'
import { HTTP_REQUEST_TOOL_NAME } from './prompt.js'
import { HttpRequestTool } from './HttpRequestTool.js'

describe('HttpRequestTool', () => {
  it('has the correct name', () => { expect(HttpRequestTool.name).toBe(HTTP_REQUEST_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await HttpRequestTool.description()).length).toBeGreaterThan(0) })
  it('has checkPermissions default from buildTool', () => { expect(typeof HttpRequestTool.checkPermissions).toBe('function') })
  it('has isEnabled default from buildTool', () => { expect(HttpRequestTool.isEnabled()).toBe(true) })

  it('marks GET as read-only', () => { expect(HttpRequestTool.isReadOnly?.({ method: 'GET' })).toBe(true) })
  it('marks HEAD as read-only', () => { expect(HttpRequestTool.isReadOnly?.({ method: 'HEAD' })).toBe(true) })
  it('marks POST as not read-only', () => { expect(HttpRequestTool.isReadOnly?.({ method: 'POST' })).toBe(false) })
  it('marks PUT as not read-only', () => { expect(HttpRequestTool.isReadOnly?.({ method: 'PUT' })).toBe(false) })
  it('marks DELETE as not read-only', () => { expect(HttpRequestTool.isReadOnly?.({ method: 'DELETE' })).toBe(false) })

  it('accepts valid URL', async () => { expect((await HttpRequestTool.validateInput({ url: 'https://api.example.com/data' })).result).toBe(true) })
  it('rejects missing URL', async () => { expect((await HttpRequestTool.validateInput({} as any)).result).toBe(false) })
  it('rejects invalid URL', async () => { expect((await HttpRequestTool.validateInput({ url: 'not-a-url' })).result).toBe(false) })

  it('asks permission for POST', async () => {
    const p = await HttpRequestTool.checkPermissions!({ method: 'POST', url: 'https://api.example.com/data' })
    expect(p.behavior).toBe('ask')
  })
  it('allows GET without permission', async () => {
    const p = await HttpRequestTool.checkPermissions!({ method: 'GET', url: 'https://api.example.com/data' })
    expect(p.behavior).toBe('allow')
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = HttpRequestTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 100 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })
  it('renders tool use message', () => {
    const m = HttpRequestTool.renderToolUseMessage?.({ url: 'https://api.example.com' })
    if (m && 'text' in m) expect(m.text).toContain('api.example.com')
  })
  it('renders success 2xx', () => {
    const m = HttpRequestTool.renderToolResultMessage?.({ success: true, response: { status: 200, statusText: 'OK', headers: {}, body: '{}' }, durationMs: 150 })
    if (m && 'text' in m) expect(m.text).toContain('200')
  })
  it('renders failed request', () => {
    const m = HttpRequestTool.renderToolResultMessage?.({ success: false, durationMs: 5, error: 'connection refused' })
    if (m && 'text' in m) expect(m.text).toContain('connection refused')
  })
  it('provides auto-classifier input', () => {
    expect(HttpRequestTool.toAutoClassifierInput?.({ method: 'GET', url: 'https://api.example.com' })).toBe('GET https://api.example.com')
  })
})
