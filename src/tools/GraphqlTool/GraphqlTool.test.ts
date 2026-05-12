import { describe, it, expect } from 'bun:test'
import { GRAPHQL_TOOL_NAME } from './prompt.js'
import { GraphqlTool } from './GraphqlTool.js'

describe('GraphqlTool', () => {
  it('has the correct name', () => { expect(GraphqlTool.name).toBe(GRAPHQL_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await GraphqlTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled default from buildTool', () => { expect(GraphqlTool.isEnabled()).toBe(true) })

  it('marks query as read-only', () => { expect(GraphqlTool.isReadOnly?.({ query: 'query { users { id } }' })).toBe(true) })
  it('marks mutation as not read-only', () => { expect(GraphqlTool.isReadOnly?.({ query: 'mutation { createUser(name: "x") { id } }' })).toBe(false) })

  it('accepts valid input', async () => { expect((await GraphqlTool.validateInput({ endpoint: 'https://api.example.com/graphql', query: 'query { users { id } }' })).result).toBe(true) })
  it('rejects missing endpoint', async () => { expect((await GraphqlTool.validateInput({} as any)).result).toBe(false) })

  it('asks permission for mutation', async () => {
    const p = await GraphqlTool.checkPermissions!({ endpoint: 'https://api.example.com/graphql', query: 'mutation { createUser(name: "x") { id } }' })
    expect(p.behavior).toBe('ask')
  })
  it('allows query without permission', async () => {
    const p = await GraphqlTool.checkPermissions!({ endpoint: 'https://api.example.com/graphql', query: 'query { users { id } }' })
    expect(p.behavior).toBe('allow')
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = GraphqlTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 50 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })
  it('renders success', () => {
    const m = GraphqlTool.renderToolResultMessage?.({ success: true, durationMs: 200 })
    if (m && 'text' in m) expect(m.text).toContain('succeeded')
  })
  it('renders GraphQL errors', () => {
    const m = GraphqlTool.renderToolResultMessage?.({ success: false, errors: [{ message: 'field not found' }], durationMs: 100 })
    if (m && 'text' in m) expect(m.text).toContain('1 error(s)')
  })
  it('provides auto-classifier', () => {
    expect(GraphqlTool.toAutoClassifierInput?.({ endpoint: 'https://api.example.com/graphql', query: 'query { users }' })).toContain('api.example.com')
  })
})
