import { describe, it, expect } from 'bun:test'
import { POSTGRES_QUERY_TOOL_NAME } from './prompt.js'
import { PostgresQueryTool } from './PostgresQueryTool.js'

describe('PostgresQueryTool', () => {
  it('has the correct name', () => {
    expect(PostgresQueryTool.name).toBe(POSTGRES_QUERY_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await PostgresQueryTool.description()).length).toBeGreaterThan(0)
  })

  it('marks SELECT as read-only', () => {
    expect(PostgresQueryTool.isReadOnly?.({ query: 'SELECT * FROM users' })).toBe(true)
  })

  it('marks INSERT as not read-only', () => {
    expect(PostgresQueryTool.isReadOnly?.({ query: 'INSERT INTO users (name) VALUES (\'test\')' })).toBe(false)
  })

  it('marks DROP as destructive', () => {
    expect(PostgresQueryTool.isDestructive?.({ query: 'DROP TABLE users' })).toBe(true)
  })

  it('marks SELECT as not destructive', () => {
    expect(PostgresQueryTool.isDestructive?.({ query: 'SELECT * FROM users' })).toBe(false)
  })

  it('validates empty query', async () => {
    expect((await PostgresQueryTool.validateInput({} as any)).result).toBe(false)
  })

  it('validates long query', async () => {
    expect((await PostgresQueryTool.validateInput({ query: 'SELECT ' + 'x'.repeat(10001) })).result).toBe(false)
  })

  it('validates valid query', async () => {
    expect((await PostgresQueryTool.validateInput({ query: 'SELECT 1' })).result).toBe(true)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = PostgresQueryTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 10, dbPath: '' }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = PostgresQueryTool.renderToolUseMessage?.({ query: 'SELECT * FROM users' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('SELECT * FROM users')
  })

  it('renders success with rows', () => {
    const msg = PostgresQueryTool.renderToolResultMessage?.({ success: true, rows: [{ id: 1 }], rowCount: 1, durationMs: 5, truncated: false })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('1 rows')
  })

  it('renders success without rows', () => {
    const msg = PostgresQueryTool.renderToolResultMessage?.({ success: true, rowCount: 3, durationMs: 8 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('3 rows affected')
  })

  it('renders error', () => {
    const msg = PostgresQueryTool.renderToolResultMessage?.({ success: false, durationMs: 3, error: 'connection refused' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('connection refused')
  })

  it('provides auto-classifier input', () => {
    expect(PostgresQueryTool.toAutoClassifierInput?.({ query: 'SELECT 1' })).toBe('SELECT 1')
  })
})
