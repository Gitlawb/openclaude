import { describe, it, expect } from 'bun:test'
import { GRAPHQL_TOOL_NAME } from './prompt.js'
import { GraphqlTool } from './GraphqlTool.js'

describe('GraphqlTool', () => {
  it('has the correct name', () => {
    expect(GraphqlTool.name).toBe(GRAPHQL_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await GraphqlTool.description()).length).toBeGreaterThan(0)
  })

  it('marks query as read-only', () => {
    expect(GraphqlTool.isReadOnly?.({ query: 'query { users { id } }' })).toBe(true)
  })

  it('marks mutation as not read-only', () => {
    expect(GraphqlTool.isReadOnly?.({ query: 'mutation { createUser(name: "x") { id } }' })).toBe(false)
  })

  it('accepts valid input', async () => {
    expect((await GraphqlTool.validateInput({ endpoint: 'https://api.example.com/graphql', query: 'query { users { id } }' })).result).toBe(true)
  })

  it('rejects missing endpoint', async () => {
    expect((await GraphqlTool.validateInput({} as any)).result).toBe(false)
  })

  it('rejects missing query', async () => {
    expect((await GraphqlTool.validateInput({ endpoint: 'https://api.example.com/graphql' } as any)).result).toBe(false)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = GraphqlTool.mapToolResultToToolResultBlockParam({ success: true, durationMs: 50 }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message for query', () => {
    const msg = GraphqlTool.renderToolUseMessage?.({ endpoint: 'https://api.example.com/graphql', query: 'query { users { id } }' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('QUERY')
  })

  it('renders success result', () => {
    const msg = GraphqlTool.renderToolResultMessage?.({ success: true, durationMs: 200 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('succeeded')
  })

  it('renders GraphQL error result', () => {
    const msg = GraphqlTool.renderToolResultMessage?.({ success: false, errors: [{ message: 'field not found' }], durationMs: 100 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('1 error(s)')
  })

  it('renders transport error result', () => {
    const msg = GraphqlTool.renderToolResultMessage?.({ success: false, durationMs: 5, error: 'connection timeout' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('connection timeout')
  })

  it('provides auto-classifier input', () => {
    expect(GraphqlTool.toAutoClassifierInput?.({ endpoint: 'https://api.example.com/graphql', query: 'query { users }' })).toContain('api.example.com')
  })
})
