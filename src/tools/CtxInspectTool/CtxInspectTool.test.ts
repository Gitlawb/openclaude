import { describe, expect, test } from 'bun:test'
import { CtxInspectTool } from './CtxInspectTool.js'
import { CTX_INSPECT_TOOL_NAME, getPrompt } from './prompt.js'

describe('CtxInspectTool', () => {
  test('tool name matches constant', () => {
    expect(CtxInspectTool.name).toBe(CTX_INSPECT_TOOL_NAME)
    expect(CTX_INSPECT_TOOL_NAME).toBe('ctx_inspect')
  })

  test('tool is read-only', () => {
    expect(CtxInspectTool.isReadOnly()).toBe(true)
  })

  test('tool is gated on context-collapse opt-in', () => {
    const mod = require('../../services/contextCollapse/index.js')
    const prev = process.env.CLAUDE_CONTEXT_COLLAPSE

    delete process.env.CLAUDE_CONTEXT_COLLAPSE
    mod.initContextCollapse()
    expect(CtxInspectTool.isEnabled()).toBe(false)

    process.env.CLAUDE_CONTEXT_COLLAPSE = '1'
    mod.initContextCollapse()
    expect(CtxInspectTool.isEnabled()).toBe(true)

    if (prev === undefined) delete process.env.CLAUDE_CONTEXT_COLLAPSE
    else process.env.CLAUDE_CONTEXT_COLLAPSE = prev
    mod.initContextCollapse()
  })

  test('tool is concurrency safe', () => {
    expect(CtxInspectTool.isConcurrencySafe()).toBe(true)
  })

  test('prompt returns non-empty string', () => {
    const prompt = getPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain('context collapse')
  })

  test('description returns prompt', async () => {
    const desc = await CtxInspectTool.description()
    expect(desc).toBe(getPrompt())
  })

  test('mapToolResultToToolResultBlockParam formats JSON output', () => {
    const output = {
      committedSpans: 2,
      collapsedMessages: 10,
      stagedSpans: 1,
      armed: true,
      health: {
        totalSpawns: 3,
        totalErrors: 0,
        totalEmptySpawns: 1,
        lastError: null,
        emptySpawnWarningEmitted: false,
      },
    }
    const result = CtxInspectTool.mapToolResultToToolResultBlockParam(
      output,
      'toolu_abc',
    )
    expect(result.type).toBe('tool_result')
    expect(result.tool_use_id).toBe('toolu_abc')
    const content = JSON.parse(result.content as string)
    expect(content.committedSpans).toBe(2)
    expect(content.collapsedMessages).toBe(10)
  })

  test('tool loads and has expected shape', () => {
    expect(typeof CtxInspectTool.name).toBe('string')
    expect(typeof CtxInspectTool.description).toBe('function')
    expect(typeof CtxInspectTool.prompt).toBe('function')
    expect(typeof CtxInspectTool.call).toBe('function')
  })
})
