import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realTokenEstimation from '../services/tokenEstimation.js'
import { createRequestSizeReport } from './requestSizeBreakdown.js'
import type { ContextData } from './analyzeContext.js'

function makeMcpTool(name: string) {
  return {
    name,
    isMcp: true,
    inputJSONSchema: { type: 'object', properties: {} },
    prompt: async () => `Prompt for ${name}`,
  } as never
}

function makeContextData(overrides: Partial<ContextData> = {}): ContextData {
  return {
    categories: [],
    totalTokens: 0,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 0,
    gridRows: [],
    model: 'test-model',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: false,
    apiUsage: null,
    ...overrides,
  }
}

async function loadAnalyzeContextForTesting() {
  return import(`./analyzeContext.js?ts=${Date.now()}-${Math.random()}`)
}

async function withMcpTokenMocks(
  isToolSearchEnabled: boolean,
  run: () => Promise<void>,
) {
  await acquireSharedMutationLock('analyzeContext.mcp.test.ts')
  try {
    mock.module('../services/tokenEstimation.js', () => ({
      ...realTokenEstimation,
      countMessagesTokensWithAPI: mock(async () => 1_500),
      countTokensViaHaikuFallback: mock(async () => null),
    }))
    mock.module('./toolSearch.js', () => ({
      isToolSearchEnabled: mock(async () => isToolSearchEnabled),
    }))

    await run()
  } finally {
    mock.restore()
    releaseSharedMutationLock()
  }
}

afterEach(() => {
  mock.restore()
})

describe('countMcpToolTokens', () => {
  test('marks MCP tools loaded and request-size groups them by server when Tool Search is not deferred', async () => {
    await withMcpTokenMocks(false, async () => {
      const { countMcpToolTokens } = await loadAnalyzeContextForTesting()
      const result = await countMcpToolTokens(
        [
          makeMcpTool('mcp__alpha__search'),
          makeMcpTool('mcp__beta__list'),
        ],
        async () => ({ mode: 'default' }) as never,
        { activeAgents: [] } as never,
        'test-model',
        [],
      )

      expect(result.deferredToolTokens).toBe(0)
      expect(result.mcpToolDetails.every(tool => tool.isLoaded)).toBe(true)

      const report = createRequestSizeReport(
        makeContextData({
          categories: [
            {
              name: 'MCP tools',
              tokens: result.mcpToolTokens,
              color: 'permission',
            },
          ],
          mcpTools: result.mcpToolDetails,
        }),
      )
      const labels = report.contributors.map(contributor => contributor.label)

      expect(labels).toContain('MCP server alpha')
      expect(labels).toContain('MCP server beta')
      expect(labels).not.toContain('MCP tool schemas')
    })
  })

  test('keeps deferred MCP schemas excluded from the outgoing request estimate when Tool Search is deferred', async () => {
    await withMcpTokenMocks(true, async () => {
      const { countMcpToolTokens } = await loadAnalyzeContextForTesting()
      const result = await countMcpToolTokens(
        [
          makeMcpTool('mcp__alpha__search'),
          makeMcpTool('mcp__beta__list'),
        ],
        async () => ({ mode: 'default' }) as never,
        { activeAgents: [] } as never,
        'test-model',
        [],
      )

      expect(result.mcpToolTokens).toBe(0)
      expect(result.deferredToolTokens).toBeGreaterThan(0)
      expect(result.mcpToolDetails.every(tool => !tool.isLoaded)).toBe(true)

      const report = createRequestSizeReport(
        makeContextData({
          categories: [
            {
              name: 'MCP tools (deferred)',
              tokens: result.deferredToolTokens,
              color: 'inactive',
              isDeferred: true,
            },
          ],
          mcpTools: result.mcpToolDetails,
        }),
      )
      const labels = report.contributors.map(contributor => contributor.label)

      expect(report.estimatedTokens).toBe(0)
      expect(labels).not.toContain('MCP server alpha')
      expect(labels).not.toContain('MCP server beta')
    })
  })
})
