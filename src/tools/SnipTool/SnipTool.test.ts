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

  test('explains the refusal condition and how to observe/repair it', () => {
    // The model needs the failure signal the prior wording omitted: a kept
    // message still carries its [id:...] tag next turn, and the fix is to snip
    // every result from that parallel-tool turn together.
    const out = SnipTool.mapToolResultToToolResultBlockParam(
      { sniped: 1 },
      'toolu_abc',
    )
    const content = String(out.content)
    expect(content).toMatch(/kept|orphan/i)
    expect(content).toContain('[id:')
  })
})
