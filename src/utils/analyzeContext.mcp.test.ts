import { afterAll, describe, expect, mock, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
} from '../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realTokenEstimation from '../services/tokenEstimation.js'

await acquireSharedMutationLock('utils/analyzeContext.mcp.test.ts')

const countMessagesTokensWithAPI = mock(async () => 40_500)

mock.module('../services/tokenEstimation.js', () => ({
  ...realTokenEstimation,
  countMessagesTokensWithAPI,
  countTokensViaHaikuFallback: mock(async () => null),
  roughTokenCountEstimation: (content: string, bytesPerToken = 4) =>
    Math.round(content.length / bytesPerToken),
}))

mock.module('./toolSearch.js', () => ({
  isToolSearchEnabled: mock(async () => false),
}))

mock.module('../tools/ToolSearchTool/prompt.js', () => ({
  TOOL_SEARCH_TOOL_NAME: 'ToolSearch',
  isDeferredTool: (tool: Tool) => tool.isMcp === true,
}))

const { countMcpToolTokens } = await import('./analyzeContext.js')

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
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
    const result = await countMcpToolTokens(
      [
        mcpTool('mcp__github__search', 80_000),
        mcpTool('mcp__linear__list', 40_000),
      ],
      emptyPermissionContext,
      null,
      'claude-sonnet-4',
    )

    expect(result.mcpToolTokens).toBe(40_000)
    expect(result.deferredToolTokens).toBe(0)
    expect(result.mcpToolDetails.map(tool => tool.isLoaded)).toEqual([
      true,
      true,
    ])
  })
})
