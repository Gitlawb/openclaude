import { describe, expect, test } from 'bun:test'
import { SnipTool } from './SnipTool.js'

describe('SnipTool.mapToolResultToToolResultBlockParam', () => {
  test('echoes the tool_use_id on a tool_result block', () => {
    const out = SnipTool.mapToolResultToToolResultBlockParam(
      { sniped: 2 },
      'toolu_abc',
    )
    expect(out.type).toBe('tool_result')
    expect(out.tool_use_id).toBe('toolu_abc')
  })

  test('reports the requested count', () => {
    const out = SnipTool.mapToolResultToToolResultBlockParam(
      { sniped: 3 },
      'toolu_abc',
    )
    expect(String(out.content)).toContain('3')
  })

  test('describes the snip as a queued request, not a guaranteed removal', () => {
    // snipCompactIfNeeded() can refuse the request on the next turn (e.g. it
    // keeps a tool_result whose paired tool_use would survive). The tool result
    // must not promise the removal already happened, or the model treats a
    // structural no-op as a successful context reduction.
    const out = SnipTool.mapToolResultToToolResultBlockParam(
      { sniped: 1 },
      'toolu_abc',
    )
    const content = String(out.content)
    expect(content).toMatch(/queued/i)
    expect(content).not.toContain('They will be removed from context')
  })

  test('does not echo internal id mechanics', () => {
    const out = SnipTool.mapToolResultToToolResultBlockParam(
      { sniped: 1 },
      'toolu_abc',
    )
    const content = String(out.content)
    expect(content).toContain('Queued 1 message(s) for snipping')
    expect(content).not.toContain('[id:')
    expect(content).not.toMatch(/tag|snip_id|message id/i)
  })
})
