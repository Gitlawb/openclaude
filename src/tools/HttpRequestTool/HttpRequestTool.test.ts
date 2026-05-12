import { describe, it, expect } from 'bun:test'
import { HTTP_REQUEST_TOOL_NAME } from './prompt.js'
import { HttpRequestTool } from './HttpRequestTool.js'

describe('HttpRequestTool', () => {
  it('has the correct name', () => {
    expect(HttpRequestTool.name).toBe(HTTP_REQUEST_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await HttpRequestTool.description()).length).toBeGreaterThan(0)
  })

  it('is always read-only', () => {
    expect(HttpRequestTool.isReadOnly?.()).toBe(true)
  })

  it('accepts valid URL', async () => {
    expect((await HttpRequestTool.validateInput({ url: 'https://api.example.com/data' })).result).toBe(true)
  })

  it('rejects missing URL', async () => {
    expect((await HttpRequestTool.validateInput({} as any)).result).toBe(false)
  })

  it('rejects invalid URL', async () => {
    expect((await HttpRequestTool.validateInput({ url: 'not-a-url' })).result).toBe(false)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = HttpRequestTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 100 }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = HttpRequestTool.renderToolUseMessage?.({ method: 'POST', url: 'https://api.example.com/users' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('POST https://api.example.com')
  })

  it('renders success 2xx', () => {
    const msg = HttpRequestTool.renderToolResultMessage?.({ success: true, response: { status: 200, statusText: 'OK', headers: {}, body: '{}' }, durationMs: 150 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('200')
  })

  it('renders failed request', () => {
    const msg = HttpRequestTool.renderToolResultMessage?.({ success: false, durationMs: 5, error: 'connection refused' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('connection refused')
  })

  it('provides auto-classifier input', () => {
    expect(HttpRequestTool.toAutoClassifierInput?.({ method: 'GET', url: 'https://api.example.com' })).toBe('GET https://api.example.com')
  })
})
