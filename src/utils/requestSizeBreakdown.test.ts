import { describe, expect, test } from 'bun:test'
import type { ContextData } from './analyzeContext.js'
import {
  createRequestSizeReport,
  formatRequestSizeReport,
} from './requestSizeBreakdown.js'

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
    messageBreakdown: {
      toolCallTokens: 0,
      toolResultTokens: 0,
      attachmentTokens: 0,
      assistantMessageTokens: 0,
      userMessageTokens: 0,
      toolCallsByType: [],
      attachmentsByType: [],
    },
    apiUsage: null,
    ...overrides,
  }
}

describe('request size breakdown', () => {
  test('large tool result appears as a top contributor', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'Messages', tokens: 20_000, color: 'permission' }],
        messageBreakdown: {
          toolCallTokens: 500,
          toolResultTokens: 16_000,
          attachmentTokens: 0,
          assistantMessageTokens: 1_500,
          userMessageTokens: 2_000,
          toolCallsByType: [
            { name: 'Bash', callTokens: 500, resultTokens: 16_000 },
          ],
          attachmentsByType: [],
        },
      }),
    )

    expect(report.topContributors[0]?.label).toBe('Tool results')
    expect(report.topContributors[0]?.tokens).toBe(16_000)
  })

  test('uses rough message contributors when the Messages category is unavailable', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [],
        messageBreakdown: {
          toolCallTokens: 500,
          toolResultTokens: 16_000,
          attachmentTokens: 0,
          assistantMessageTokens: 1_500,
          userMessageTokens: 2_000,
          toolCallsByType: [
            { name: 'Bash', callTokens: 500, resultTokens: 16_000 },
          ],
          attachmentsByType: [],
        },
      }),
    )

    expect(report.estimatedTokens).toBe(20_000)
    expect(report.topContributors[0]).toEqual(
      expect.objectContaining({ label: 'Tool results', tokens: 16_000 }),
    )
  })

  test('message contributor estimates are reconciled to the Messages category total', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'Messages', tokens: 1_000, color: 'permission' }],
        messageBreakdown: {
          toolCallTokens: 0,
          toolResultTokens: 8_000,
          attachmentTokens: 0,
          assistantMessageTokens: 500,
          userMessageTokens: 500,
          toolCallsByType: [
            { name: 'Bash', callTokens: 0, resultTokens: 8_000 },
          ],
          attachmentsByType: [],
        },
      }),
    )

    const toolResults = report.contributors.find(
      contributor => contributor.label === 'Tool results',
    )
    const conversationHistory = report.contributors.find(
      contributor => contributor.label === 'Conversation history',
    )

    expect(report.estimatedTokens).toBe(1_000)
    expect(toolResults?.tokens).toBe(889)
    expect(conversationHistory?.tokens).toBe(111)
  })

  test('message contributor rounding preserves the Messages category total', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'Messages', tokens: 2, color: 'permission' }],
        messageBreakdown: {
          toolCallTokens: 1,
          toolResultTokens: 1,
          attachmentTokens: 1,
          assistantMessageTokens: 0,
          userMessageTokens: 0,
          toolCallsByType: [{ name: 'Bash', callTokens: 1, resultTokens: 1 }],
          attachmentsByType: [{ name: 'image', tokens: 1 }],
        },
      }),
    )

    const messageContributorTokens = report.contributors
      .filter(contributor =>
        ['tool_calls', 'tool_results', 'attachments'].includes(
          contributor.kind,
        ),
      )
      .reduce((sum, contributor) => sum + contributor.tokens, 0)

    expect(report.estimatedTokens).toBe(2)
    expect(messageContributorTokens).toBe(2)
    expect(report.contributors).not.toContainEqual(
      expect.objectContaining({ label: 'Other request content' }),
    )
  })

  test('MCP tool schemas are grouped by server', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'MCP tools', tokens: 30_000, color: 'permission' }],
        mcpTools: [
          {
            name: 'mcp__github__search',
            serverName: 'github',
            tokens: 20_000,
            isLoaded: true,
          },
          {
            name: 'mcp__linear__list',
            serverName: 'linear',
            tokens: 10_000,
            isLoaded: true,
          },
        ],
      }),
    )

    expect(report.contributors.map(c => c.label)).toContain('MCP server github')
    expect(report.contributors.map(c => c.label)).toContain('MCP server linear')
  })

  test('MCP server rounding preserves the MCP tools category total', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'MCP tools', tokens: 2, color: 'permission' }],
        mcpTools: [
          {
            name: 'mcp__one__search',
            serverName: 'one',
            tokens: 1,
            isLoaded: true,
          },
          {
            name: 'mcp__two__search',
            serverName: 'two',
            tokens: 1,
            isLoaded: true,
          },
          {
            name: 'mcp__three__search',
            serverName: 'three',
            tokens: 1,
            isLoaded: true,
          },
        ],
      }),
    )

    const mcpTokens = report.contributors
      .filter(contributor => contributor.kind === 'mcp_tool_schemas')
      .reduce((sum, contributor) => sum + contributor.tokens, 0)

    expect(report.estimatedTokens).toBe(2)
    expect(mcpTokens).toBe(2)
    expect(report.contributors).not.toContainEqual(
      expect.objectContaining({ label: 'Other request content' }),
    )
  })

  test('deferred MCP schemas are excluded from the outgoing request estimate', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [
          {
            name: 'MCP tools (deferred)',
            tokens: 50_000,
            color: 'inactive',
            isDeferred: true,
          },
        ],
        mcpTools: [
          {
            name: 'mcp__github__search',
            serverName: 'github',
            tokens: 50_000,
            isLoaded: false,
          },
        ],
      }),
    )

    expect(report.contributors.map(c => c.label)).not.toContain(
      'MCP server github',
    )
    expect(report.estimatedTokens).toBe(0)
  })

  test('attachments and media are counted separately from conversation history', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'Messages', tokens: 12_500, color: 'permission' }],
        messageBreakdown: {
          toolCallTokens: 0,
          toolResultTokens: 0,
          attachmentTokens: 8_000,
          assistantMessageTokens: 2_000,
          userMessageTokens: 2_500,
          toolCallsByType: [],
          attachmentsByType: [{ name: 'image', tokens: 8_000 }],
        },
      }),
    )

    expect(report.contributors).toContainEqual(
      expect.objectContaining({ label: 'Attachments/media', tokens: 8_000 }),
    )
    expect(report.contributors).toContainEqual(
      expect.objectContaining({ label: 'Conversation history', tokens: 4_500 }),
    )
  })

  test('built-in tool schemas are counted separately', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [
          { name: 'System prompt', tokens: 1_000, color: 'permission' },
          { name: 'System tools', tokens: 7_000, color: 'permission' },
        ],
      }),
    )

    expect(report.contributors).toContainEqual(
      expect.objectContaining({ label: 'Tool schemas', tokens: 7_000 }),
    )
  })

  test('formatted report does not print secret-looking contributor names', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'MCP tools', tokens: 1_000, color: 'permission' }],
        mcpTools: [
          {
            name: 'mcp__sk-test-secret123456789__tool',
            serverName: 'sk-test-secret123456789',
            tokens: 1_000,
            isLoaded: true,
          },
        ],
      }),
    )

    const output = formatRequestSizeReport(report)

    expect(output).toContain('MCP server redacted')
    expect(output).not.toContain('sk-test-secret123456789')
  })

  test('formatted report redacts common token prefixes from contributor names', () => {
    const output = formatRequestSizeReport(
      createRequestSizeReport(
        makeContextData({
          categories: [{ name: 'MCP tools', tokens: 4_000, color: 'permission' }],
          mcpTools: [
            {
              name: 'mcp__github__tool',
              serverName: `ghp_${'a'.repeat(36)}`,
              tokens: 1_000,
              isLoaded: true,
            },
            {
              name: 'mcp__github-fine__tool',
              serverName: `github_pat_${'b'.repeat(82)}`,
              tokens: 1_000,
              isLoaded: true,
            },
            {
              name: 'mcp__aws__tool',
              serverName: `AKIA${'A'.repeat(16)}`,
              tokens: 1_000,
              isLoaded: true,
            },
            {
              name: 'mcp__slack__tool',
              serverName: `xoxb-1234567890-1234567890-${'c'.repeat(24)}`,
              tokens: 1_000,
              isLoaded: true,
            },
          ],
        }),
      ),
    )

    expect(output).not.toContain('ghp_')
    expect(output).not.toContain('github_pat_')
    expect(output).not.toContain('AKIA')
    expect(output).not.toContain('xoxb-')
    expect(output).toContain('MCP server redacted')
  })

  test('formatted tool details redact secrets and preserve the markdown table', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [{ name: 'Messages', tokens: 9_000, color: 'permission' }],
        messageBreakdown: {
          toolCallTokens: 0,
          toolResultTokens: 9_000,
          attachmentTokens: 0,
          assistantMessageTokens: 0,
          userMessageTokens: 0,
          toolCallsByType: [
            {
              name: 'Fetch|token=sk-test-secret123456789',
              callTokens: 0,
              resultTokens: 9_000,
            },
          ],
          attachmentsByType: [],
        },
      }),
    )

    const output = formatRequestSizeReport(report)

    expect(output).toContain('Fetch/token=redacted')
    expect(output).not.toContain('sk-test-secret123456789')
    expect(output).not.toContain('Fetch|token=')
  })

  test('formatted report describes a token-derived context estimate with media caveat', () => {
    const output = formatRequestSizeReport(
      createRequestSizeReport(
        makeContextData({
          categories: [
            { name: 'System prompt', tokens: 1_000, color: 'permission' },
            { name: 'Messages', tokens: 2_000, color: 'permission' },
          ],
          messageBreakdown: {
            toolCallTokens: 0,
            toolResultTokens: 0,
            attachmentTokens: 1_000,
            assistantMessageTokens: 500,
            userMessageTokens: 500,
            toolCallsByType: [],
            attachmentsByType: [{ name: 'image', tokens: 1_000 }],
          },
        }),
      ),
    )

    expect(output).toContain('Request context size')
    expect(output).toContain('Estimated context load:')
    expect(output).toContain('rough byte equivalent at ~4 bytes/token')
    expect(output).toContain(
      'This is a context/token estimate, not the serialized JSON request-body size.',
    )
    expect(output).toContain(
      'Base64 image/PDF/media payloads may be much larger on the wire.',
    )
    expect(output).not.toContain('Estimated request size:')
  })

  test('formatted report does not print request content', () => {
    const output = formatRequestSizeReport(
      createRequestSizeReport(
        makeContextData({
          categories: [{ name: 'Messages', tokens: 8_000, color: 'permission' }],
          messageBreakdown: {
            toolCallTokens: 0,
            toolResultTokens: 0,
            attachmentTokens: 8_000,
            assistantMessageTokens: 0,
            userMessageTokens: 0,
            toolCallsByType: [],
            attachmentsByType: [
              {
                name: 'image/png;base64,SECRET_IMAGE_BYTES_SHOULD_NOT_PRINT',
                tokens: 8_000,
              },
            ],
          },
        }),
      ),
    )

    expect(output).toContain('Attachments/media')
    expect(output).not.toContain('SECRET_IMAGE_BYTES_SHOULD_NOT_PRINT')
  })

  test('unknown request categories are reported as other request content', () => {
    const report = createRequestSizeReport(
      makeContextData({
        categories: [
          { name: 'Provider shim overhead', tokens: 1_250, color: 'inactive' },
        ],
      }),
    )

    expect(report.contributors).toContainEqual(
      expect.objectContaining({
        label: 'Other request content',
        tokens: 1_250,
      }),
    )
  })

  test('empty context formats without fake contributors', () => {
    const report = createRequestSizeReport(makeContextData())

    expect(report.estimatedTokens).toBe(0)
    expect(formatRequestSizeReport(report)).toContain(
      'No request contributors found',
    )
  })

  test('formats an estimate without provider credentials', () => {
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
    const originalOpenAIKey = process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY

    try {
      const output = formatRequestSizeReport(
        createRequestSizeReport(
          makeContextData({
            categories: [
              { name: 'System prompt', tokens: 1_000, color: 'permission' },
              { name: 'Messages', tokens: 2_000, color: 'permission' },
            ],
            messageBreakdown: {
              toolCallTokens: 0,
              toolResultTokens: 0,
              attachmentTokens: 0,
              assistantMessageTokens: 1_000,
              userMessageTokens: 1_000,
              toolCallsByType: [],
              attachmentsByType: [],
            },
          }),
        ),
      )

      expect(output).toContain('Estimated context load:')
    } finally {
      if (originalAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = originalAnthropicKey
      }
      if (originalOpenAIKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalOpenAIKey
      }
    }
  })
})
