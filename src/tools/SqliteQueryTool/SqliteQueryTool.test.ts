import { describe, it, expect } from 'bun:test'
import { SQLITE_QUERY_TOOL_NAME } from './prompt.js'
import { SqliteQueryTool } from './SqliteQueryTool.js'

describe('SqliteQueryTool', () => {
  it('has the correct name', () => {
    expect(SqliteQueryTool.name).toBe(SQLITE_QUERY_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await SqliteQueryTool.description()).length).toBeGreaterThan(0)
  })

  it('marks read mode as read-only', () => {
    expect(SqliteQueryTool.isReadOnly?.({ mode: 'read', path: 'test.db', query: 'SELECT 1' })).toBe(true)
  })

  it('marks write mode as not read-only', () => {
    expect(SqliteQueryTool.isReadOnly?.({ mode: 'write', path: 'test.db', query: 'SELECT 1' })).toBe(false)
  })

  it('marks INSERT query as not read-only even in read mode', () => {
    expect(SqliteQueryTool.isReadOnly?.({ mode: 'read', path: 'test.db', query: 'INSERT INTO t VALUES(1)' })).toBe(false)
  })

  it('marks DROP as destructive', () => {
    expect(SqliteQueryTool.isDestructive?.({ query: 'DROP TABLE users' })).toBe(true)
  })

  it('marks SELECT as not destructive', () => {
    expect(SqliteQueryTool.isDestructive?.({ query: 'SELECT * FROM users' })).toBe(false)
  })

  it('validates empty path', async () => {
    expect((await SqliteQueryTool.validateInput({ path: '', query: 'SELECT 1' })).result).toBe(false)
  })

  it('validates empty query', async () => {
    expect((await SqliteQueryTool.validateInput({ path: 'test.db', query: '' })).result).toBe(false)
  })

  it('rejects non-db extension', async () => {
    expect((await SqliteQueryTool.validateInput({ path: 'data.txt', query: 'SELECT 1' })).result).toBe(false)
  })

  it('accepts .db extension', async () => {
    expect((await SqliteQueryTool.validateInput({ path: 'test.db', query: 'SELECT 1' })).result).toBe(true)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = SqliteQueryTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 5, dbPath: '/tmp/test.db' }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = SqliteQueryTool.renderToolUseMessage?.({ path: 'data.db', query: 'SELECT * FROM items' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('data.db')
  })

  it('renders success with rows', () => {
    const msg = SqliteQueryTool.renderToolResultMessage?.({ success: true, rows: [{ id: 1 }], rowCount: 1, durationMs: 2, truncated: false, dbPath: '/tmp/test.db' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('1 rows')
  })

  it('renders without rows', () => {
    const msg = SqliteQueryTool.renderToolResultMessage?.({ success: true, rowCount: 3, durationMs: 4, dbPath: '/tmp/test.db' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('3 rows affected')
  })

  it('renders error', () => {
    const msg = SqliteQueryTool.renderToolResultMessage?.({ success: false, durationMs: 1, error: 'no such table', dbPath: '/tmp/test.db' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('no such table')
  })

  it('provides auto-classifier input', () => {
    expect(SqliteQueryTool.toAutoClassifierInput?.({ path: 'test.db', query: 'SELECT 1' })).toContain('SELECT 1')
  })
})
