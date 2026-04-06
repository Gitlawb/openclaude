import { describe, it, expect } from 'bun:test'
import { getCombinedTools } from './mcp.js'
import type { Tool as InternalTool } from '../Tool.js'

describe('getCombinedTools', () => {
  it('deduplicates builtins when mcpTools have the same name, prioritizing mcpTools', () => {
    const builtinBash = { name: 'Bash', isMcp: false } as unknown as InternalTool
    const builtinRead = { name: 'Read', isMcp: false } as unknown as InternalTool
    const mcpBash = { name: 'Bash', isMcp: true } as unknown as InternalTool

    const builtins = [builtinBash, builtinRead]
    const mcpTools = [mcpBash]

    const result = getCombinedTools(builtins, mcpTools)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(mcpBash)
    expect(result[1]).toBe(builtinRead)
  })
})
