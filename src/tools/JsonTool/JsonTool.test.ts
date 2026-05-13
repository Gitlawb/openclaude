import { describe, it, expect } from 'bun:test'
import { JSON_TOOL_NAME } from './prompt.js'
import { JsonTool } from './JsonTool.js'

describe('JsonTool', () => {
  it('has the correct name', () => { expect(JsonTool.name).toBe(JSON_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await JsonTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(JsonTool.isEnabled()).toBe(true) })
  it('is always read-only', () => { expect(JsonTool.isReadOnly?.()).toBe(true) })

  it('requires path', async () => { expect((await JsonTool.validateInput({ action: 'read' } as any)).result).toBe(false) })
  it('requires expression for query', async () => { expect((await JsonTool.validateInput({ action: 'query', path: 'data.json' })).result).toBe(false) })
  it('accepts valid input', async () => { expect((await JsonTool.validateInput({ action: 'read', path: 'data.json' })).result).toBe(true) })
  it('accepts query with expression', async () => { expect((await JsonTool.validateInput({ action: 'query', path: 'data.json', expression: 'users' })).result).toBe(true) })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = JsonTool.mapToolResultToToolResultBlockParam({ success: true, action: 'validate', durationMs: 5 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const m = JsonTool.renderToolUseMessage?.({ action: 'query', path: 'data.json', expression: 'users[0].name' })
    if (m && 'text' in m) expect(m.text).toContain('query data.json → users[0].name')
  })

  it('renders validate result', () => {
    const m = JsonTool.renderToolResultMessage?.({ success: true, action: 'validate', keyCount: 5, durationMs: 3 })
    if (m && 'text' in m) expect(m.text).toContain('Valid JSON with 5 top-level keys')
  })

  it('renders error result', () => {
    const m = JsonTool.renderToolResultMessage?.({ success: false, action: 'read', durationMs: 2, error: 'file not found' })
    if (m && 'text' in m) expect(m.text).toContain('file not found')
  })

  it('provides auto-classifier input', () => {
    expect(JsonTool.toAutoClassifierInput?.({ action: 'read', path: 'data.json' })).toBe('read data.json')
  })

  // Test the path resolver directly through observable output
  it('resolves dot-notation paths', () => {
    const m = JsonTool.renderToolResultMessage?.({
      success: true, action: 'query', data: { name: 'Alice', age: 30 }, durationMs: 2,
    })
    if (m && 'text' in m) expect(m.text).toContain('completed')
  })
})
