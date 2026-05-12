import { describe, it, expect } from 'bun:test'
import { SQLITE_QUERY_TOOL_NAME } from './prompt.js'
import { SqliteQueryTool } from './SqliteQueryTool.js'

describe('SqliteQueryTool', () => {
  it('has the correct name', () => { expect(SqliteQueryTool.name).toBe(SQLITE_QUERY_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await SqliteQueryTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(SqliteQueryTool.isEnabled()).toBe(true) })

  it('marks read mode as read-only', () => { expect(SqliteQueryTool.isReadOnly?.({ mode: 'read', query: 'SELECT 1' })).toBe(true) })
  it('marks write mode as not read-only', () => { expect(SqliteQueryTool.isReadOnly?.({ mode: 'write', query: 'SELECT 1' })).toBe(false) })
  it('marks INSERT as not read-only', () => { expect(SqliteQueryTool.isReadOnly?.({ mode: 'read', query: 'INSERT INTO t VALUES(1)' })).toBe(false) })
  it('marks DROP as destructive', () => { expect(SqliteQueryTool.isDestructive?.({ query: 'DROP TABLE users' })).toBe(true) })
  it('marks SELECT as not destructive', () => { expect(SqliteQueryTool.isDestructive?.({ query: 'SELECT * FROM users' })).toBe(false) })

  it('asks permission for execution', async () => {
    const p = await SqliteQueryTool.checkPermissions!({ path: 'test.db', query: 'SELECT 1' })
    expect(p.behavior).toBe('ask')
  })

  it('validates empty path', async () => { expect((await SqliteQueryTool.validateInput({ path: '', query: 'SELECT 1' })).result).toBe(false) })
  it('validates empty query', async () => { expect((await SqliteQueryTool.validateInput({ path: 'test.db', query: '' })).result).toBe(false) })
  it('rejects non-db extension', async () => { expect((await SqliteQueryTool.validateInput({ path: 'data.txt', query: 'SELECT 1' })).result).toBe(false) })
  it('accepts .db extension', async () => { expect((await SqliteQueryTool.validateInput({ path: 'test.db', query: 'SELECT 1' })).result).toBe(true) })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = SqliteQueryTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 5, dbPath: '/tmp/test.db' }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })

  it('renders success with rows', () => {
    const m = SqliteQueryTool.renderToolResultMessage?.({ success: true, rows: [{ id: 1 }], rowCount: 1, durationMs: 2, truncated: false, dbPath: '/tmp/test.db' })
    if (m && 'text' in m) expect(m.text).toContain('1 rows')
  })
  it('renders error', () => {
    const m = SqliteQueryTool.renderToolResultMessage?.({ success: false, durationMs: 1, error: 'no such table', dbPath: '/tmp/test.db' })
    if (m && 'text' in m) expect(m.text).toContain('no such table')
  })
  it('provides auto-classifier', () => { expect(SqliteQueryTool.toAutoClassifierInput?.({ path: 'test.db', query: 'SELECT 1' })).toContain('SELECT 1') })
})
