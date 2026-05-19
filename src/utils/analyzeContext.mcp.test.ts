import { afterAll, describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
} from '../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { countMcpToolTokens } from './analyzeContext.js'

await acquireSharedMutationLock('utils/analyzeContext.mcp.test.ts')

afterAll(() => {
  releaseSharedMutationLock()
})

function mcpTool(name: string, descriptionLength: number): Tool {
  return {
    name,
    isMcp: true,
    mcpInfo: { serverName: name.split('__')[1], toolName: name.split('__')[2] },
    inputJSONSchema: { type: 'object', properties: {} },
    async prompt() {
      return 'x'.repeat(descriptionLength)
    },
  } as unknown as Tool
}

const emptyPermissionContext = async (): Promise<ToolPermissionContext> =>
  getEmptyToolPermissionContext()

describe('countMcpToolTokens', () => {
  test('marks MCP tools as loaded when Tool Search is disabled', async () => {
    const countToolDefinitions = async () => 40_500

    const result = await countMcpToolTokens(
      [
        mcpTool('mcp__github__search', 80_000),
        mcpTool('mcp__linear__list', 40_000),
      ],
      emptyPermissionContext,
      null,
      'claude-sonnet-4',
      undefined,
      countToolDefinitions,
    )

    expect(result.mcpToolTokens).toBe(40_000)
    expect(result.deferredToolTokens).toBe(0)
    expect(result.mcpToolDetails.map(tool => tool.isLoaded)).toEqual([
      true,
      true,
    ])
  })
})
