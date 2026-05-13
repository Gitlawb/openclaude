import { describe, it, expect } from 'bun:test'
import { CSV_TOOL_NAME } from './prompt.js'
import { CsvTool } from './CsvTool.js'

describe('CsvTool', () => {
  it('has the correct name', () => { expect(CsvTool.name).toBe(CSV_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await CsvTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(CsvTool.isEnabled()).toBe(true) })
  it('is always read-only', () => { expect(CsvTool.isReadOnly?.()).toBe(true) })

  it('requires path', async () => { expect((await CsvTool.validateInput({ action: 'read' } as any)).result).toBe(false) })
  it('accepts valid input', async () => { expect((await CsvTool.validateInput({ action: 'read', path: 'data.csv' })).result).toBe(true) })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = CsvTool.mapToolResultToToolResultBlockParam({ success: true, action: 'read', rowCount: 10, durationMs: 5 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const m = CsvTool.renderToolUseMessage?.({ action: 'query', path: 'data.csv', filter: 'age > 18' })
    if (m && 'text' in m) expect(m.text).toContain('query data.csv where age > 18')
  })

  it('renders stats result', () => {
    const m = CsvTool.renderToolResultMessage?.({ success: true, action: 'stats', rowCount: 100, columns: ['name', 'age'], durationMs: 10 })
    if (m && 'text' in m) expect(m.text).toContain('stats: 100 rows, 2 columns')
  })

  it('renders error result', () => {
    const m = CsvTool.renderToolResultMessage?.({ success: false, action: 'read', rowCount: 0, durationMs: 3, error: 'file not found' })
    if (m && 'text' in m) expect(m.text).toContain('file not found')
  })

  it('provides auto-classifier input', () => {
    expect(CsvTool.toAutoClassifierInput?.({ action: 'read', path: 'data.csv' })).toBe('read data.csv')
  })
})
