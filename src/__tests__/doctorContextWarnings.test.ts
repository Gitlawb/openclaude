import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type Tool } from '../Tool.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import { checkContextWarnings } from '../utils/doctorContextWarnings.js'

const emptyPermissionContext = async () => getEmptyToolPermissionContext()

function mcpTool(serverName: string, toolName: string, descriptionLength: number): Tool {
  return {
    name: `mcp__${serverName}__${toolName}`,
    isMcp: true,
    mcpInfo: { serverName, toolName },
    inputJSONSchema: { type: 'object', properties: {} },
    async prompt() {
      return 'x'.repeat(descriptionLength)
    },
  } as unknown as Tool
}

function mcpToolThatReadsPermissionContext(): Tool {
  return {
    name: 'mcp__permissionserver__search',
    isMcp: true,
    mcpInfo: { serverName: 'permissionserver', toolName: 'search' },
    inputJSONSchema: { type: 'object', properties: {} },
    async prompt({ getToolPermissionContext }) {
      await getToolPermissionContext()
      return 'permission-aware tool'
    },
  } as unknown as Tool
}

function toolSearchTool(): Tool {
  return {
    name: 'ToolSearch',
    isMcp: false,
    inputJSONSchema: { type: 'object', properties: {} },
    async prompt() {
      return 'search deferred tools'
    },
  } as unknown as Tool
}

describe('checkContextWarnings', () => {
  test('estimated MCP warning includes prompt descriptions and top server contributors', async () => {
    const warnings = await checkContextWarnings(
      [mcpTool('github', 'search', 80_000), mcpTool('linear', 'list', 40_000)],
      null,
      emptyPermissionContext,
      { memoryFiles: [], mcpTokenStrategy: 'estimate' },
    )

    expect(warnings.mcpWarning?.currentValue).toBeGreaterThan(25_000)
    expect(warnings.mcpWarning?.details).toEqual([
      expect.stringMatching(/^github: 1 tools \(~20,\d+ tokens\)$/),
      expect.stringMatching(/^linear: 1 tools \(~10,\d+ tokens\)$/),
    ])
  })

  test('large agent descriptions list top contributors', async () => {
    const agentDefinitions: AgentDefinitionsResult = {
      activeAgents: [
        {
          agentType: 'planner',
          whenToUse: 'x'.repeat(80_000),
          source: 'userSettings',
          getSystemPrompt: () => '',
        },
        {
          agentType: 'reviewer',
          whenToUse: 'x'.repeat(20_000),
          source: 'projectSettings',
          getSystemPrompt: () => '',
        },
      ],
      allAgents: [],
    }

    const warnings = await checkContextWarnings(
      [],
      agentDefinitions,
      emptyPermissionContext,
      { memoryFiles: [] },
    )

    expect(warnings.agentWarning?.details).toEqual([
      expect.stringMatching(/^planner: ~20,\d+ tokens$/),
      expect.stringMatching(/^reviewer: ~5,\d+ tokens$/),
    ])
  })

  test('large CLAUDE.md warnings show file paths and sizes', async () => {
    const warnings = await checkContextWarnings(
      [],
      null,
      emptyPermissionContext,
      {
        memoryFiles: [
          {
            path: '/repo/CLAUDE.md',
            type: 'Project',
            content: 'x'.repeat(50_000),
          },
          {
            path: '/repo/.claude/rules/backend.md',
            type: 'Project',
            content: 'y'.repeat(45_000),
          },
        ],
      },
    )

    expect(warnings.claudeMdWarning?.details).toEqual([
      '/repo/CLAUDE.md: 50,000 chars',
      '/repo/.claude/rules/backend.md: 45,000 chars',
    ])
  })

  test('keeps unrelated context warnings when Tool Search accounting fails', async () => {
    const previousToolSearch = process.env.ENABLE_TOOL_SEARCH
    process.env.ENABLE_TOOL_SEARCH = 'auto'
    try {
      const warnings = await checkContextWarnings(
        [toolSearchTool(), mcpToolThatReadsPermissionContext()],
        null,
        async () => {
          throw new Error('permission context unavailable')
        },
        {
          memoryFiles: [
            {
              path: '/repo/CLAUDE.md',
              type: 'Project',
              content: 'x'.repeat(50_000),
            },
          ],
          includeUnreachableRules: false,
          mcpTokenStrategy: 'estimate',
        },
      )

      expect(warnings.claudeMdWarning?.message).toContain(
        'Large CLAUDE.md file detected',
      )
    } finally {
      if (previousToolSearch === undefined) {
        delete process.env.ENABLE_TOOL_SEARCH
      } else {
        process.env.ENABLE_TOOL_SEARCH = previousToolSearch
      }
    }
  })

  test('keeps CLAUDE.md warning when unreachable-rules diagnostics fail', async () => {
    const warnings = await checkContextWarnings(
      [],
      null,
      async () => {
        throw new Error('permission context unavailable')
      },
      {
        memoryFiles: [
          {
            path: '/repo/CLAUDE.md',
            type: 'Project',
            content: 'x'.repeat(50_000),
          },
        ],
      },
    )

    expect(warnings.claudeMdWarning?.message).toContain(
      'Large CLAUDE.md file detected',
    )
    expect(warnings.mcpWarning).toBeNull()
    expect(warnings.unreachableRulesWarning).toBeNull()
  })
})
