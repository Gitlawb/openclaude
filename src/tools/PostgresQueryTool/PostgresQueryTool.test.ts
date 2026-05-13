import { describe, it, expect } from 'bun:test'
import { POSTGRES_QUERY_TOOL_NAME } from './prompt.js'
import { PostgresQueryTool } from './PostgresQueryTool.js'

describe('PostgresQueryTool', () => {
  it('has the correct name', () => { expect(PostgresQueryTool.name).toBe(POSTGRES_QUERY_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await PostgresQueryTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(PostgresQueryTool.isEnabled()).toBe(true) })

  it('marks SELECT as read-only', () => { expect(PostgresQueryTool.isReadOnly?.({ query: 'SELECT * FROM users' })).toBe(true) })
  it('marks WITH as not read-only', () => { expect(PostgresQueryTool.isReadOnly?.({ query: 'WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d' })).toBe(false) })
  it('marks INSERT as not read-only', () => { expect(PostgresQueryTool.isReadOnly?.({ query: 'INSERT INTO users (name) VALUES (\'t\')' })).toBe(false) })
  it('marks DROP as destructive', () => { expect(PostgresQueryTool.isDestructive?.({ query: 'DROP TABLE users' })).toBe(true) })
  it('marks SELECT as not destructive', () => { expect(PostgresQueryTool.isDestructive?.({ query: 'SELECT 1' })).toBe(false) })

  it('asks permission for destructive queries', async () => {
    const p = await PostgresQueryTool.checkPermissions!({ query: 'DROP TABLE users' })
    expect(p.behavior).toBe('ask')
  })
  it('allows SELECT without permission', async () => {
    const p = await PostgresQueryTool.checkPermissions!({ query: 'SELECT 1' })
    expect(p.behavior).toBe('allow')
  })

  it('validates empty query', async () => { expect((await PostgresQueryTool.validateInput({} as any)).result).toBe(false) })
  it('validates valid query', async () => { expect((await PostgresQueryTool.validateInput({ query: 'SELECT 1' })).result).toBe(true) })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = PostgresQueryTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 10, dbPath: '' }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })

  it('renders success with rows', () => { expect(PostgresQueryTool.renderToolResultMessage?.({ success: true, rows: [{ id: 1 }], rowCount: 1, durationMs: 5, truncated: false })).toContain('1 rows') })
  it('renders error', () => { expect(PostgresQueryTool.renderToolResultMessage?.({ success: false, durationMs: 3, error: 'connection refused' })).toContain('connection refused') })
  it('provides auto-classifier', () => { expect(PostgresQueryTool.toAutoClassifierInput?.({ query: 'SELECT 1' })).toBe('SELECT 1') })
  it('renders aligned output', () => { expect(PostgresQueryTool.renderToolResultMessage?.({ success: true, rows: [{ id: 1, name: 'alice' }], rowCount: 1, columns: ['id', 'name'], durationMs: 10 })).toContain('1 rows') })
  it('renders CSV output', () => { expect(PostgresQueryTool.renderToolResultMessage?.({ success: true, rows: [{ id: 1, name: 'hello, world' }], rowCount: 1, columns: ['id', 'name'], durationMs: 5 })).toContain('1 rows') })
})
