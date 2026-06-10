import { describe, expect, test } from 'bun:test'
import { MCPTool, type Output } from './MCPTool.js'

type MCPToolWithValidator = typeof MCPTool & {
  validateInput: NonNullable<typeof MCPTool.validateInput>
}

type MCPToolWithTruncationCheck = typeof MCPTool & {
  isResultTruncated: NonNullable<typeof MCPTool.isResultTruncated>
}

function withValidator(tool: typeof MCPTool): MCPToolWithValidator {
  if (!tool.validateInput) {
    throw new Error('MCPTool.validateInput is required for these tests')
  }
  return tool as MCPToolWithValidator
}

function withTruncationCheck(tool: typeof MCPTool): MCPToolWithTruncationCheck {
  if (!tool.isResultTruncated) {
    throw new Error('MCPTool.isResultTruncated is required for these tests')
  }
  return tool as MCPToolWithTruncationCheck
}

// =============================================================================
// MCPTool.validateInput — AJV schema validation
// =============================================================================

describe('MCPTool.validateInput', () => {
  test('passes when no inputJSONSchema is set', async () => {
    const tool = { ...MCPTool, inputJSONSchema: undefined }
    const result = await withValidator(tool).validateInput(
      { anything: 'goes' },
      {} as never,
    )
    expect(result.result).toBe(true)
  })

  test('validates against inputJSONSchema when set', async () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    }
    const tool = { ...MCPTool, inputJSONSchema: schema }

    // Valid input
    const valid = await withValidator(tool).validateInput(
      { name: 'test' },
      {} as never,
    )
    expect(valid.result).toBe(true)

    // Missing required field
    const invalid = await withValidator(tool).validateInput({}, {} as never)
    expect(invalid.result).toBe(false)
    expect(invalid.result === false && invalid.message).toContain('name')
  })

  test('rejects extra properties when additionalProperties is false', async () => {
    const schema = {
      type: 'object' as const,
      properties: {
        x: { type: 'number' },
      },
      additionalProperties: false,
    }
    const tool = { ...MCPTool, inputJSONSchema: schema }

    const result = await withValidator(tool).validateInput(
      { x: 1, extra: 'bad' },
      {} as never,
    )
    expect(result.result).toBe(false)
  })

  test('handles invalid schema gracefully', async () => {
    // Schema that will cause ajv.compile to throw
    const schema = { type: 'invalid_type' } as any
    const tool = { ...MCPTool, inputJSONSchema: schema }

    const result = await withValidator(tool).validateInput({}, {} as never)
    expect(result.result).toBe(false)
    expect(result.result === false && result.errorCode).toBe(500)
    expect(result.result === false && result.message).toContain('Failed to compile')
  })

  test('error message is readable (not [object Object])', async () => {
    const schema = { type: 'invalid_type' } as any
    const tool = { ...MCPTool, inputJSONSchema: schema }

    const result = await withValidator(tool).validateInput({}, {} as never)
    expect(result.result).toBe(false)
    // Should NOT contain [object Object]
    expect(result.result === false && result.message).not.toContain('[object Object]')
  })
})

// =============================================================================
// MCPTool.mapToolResultToToolResultBlockParam — null safety
// =============================================================================

describe('MCPTool.mapToolResultToToolResultBlockParam', () => {
  test('handles string content', () => {
    const result = MCPTool.mapToolResultToToolResultBlockParam('hello', 'tool-1')
    expect(result.content).toBe('hello')
    expect(result.tool_use_id).toBe('tool-1')
    expect(result.type).toBe('tool_result')
  })

  test('handles array content', () => {
    const blocks = [{ type: 'text' as const, text: 'hello' }] satisfies Output
    const result = MCPTool.mapToolResultToToolResultBlockParam(blocks, 'tool-2')
    expect(result.content).toEqual(blocks)
  })

  test('handles undefined content gracefully', () => {
    const result = MCPTool.mapToolResultToToolResultBlockParam(undefined as any, 'tool-3')
    expect(result.content).toBe('[No content returned from MCP tool]')
    expect(result.tool_use_id).toBe('tool-3')
  })

  test('handles null content gracefully', () => {
    const result = MCPTool.mapToolResultToToolResultBlockParam(null as any, 'tool-4')
    expect(result.content).toBe('[No content returned from MCP tool]')
    expect(result.tool_use_id).toBe('tool-4')
  })
})

// =============================================================================
// MCPTool.isResultTruncated
// =============================================================================

describe('MCPTool.isResultTruncated', () => {
  test('returns false for short string', () => {
    expect(withTruncationCheck(MCPTool).isResultTruncated('short')).toBe(false)
  })

  test('returns false for empty array', () => {
    expect(withTruncationCheck(MCPTool).isResultTruncated([])).toBe(false)
  })

  test('returns false for array with short text blocks', () => {
    expect(
      withTruncationCheck(MCPTool).isResultTruncated([
        { type: 'text', text: 'short' },
      ]),
    ).toBe(false)
  })

  test('handles null blocks in array', () => {
    expect(
      withTruncationCheck(MCPTool).isResultTruncated([
        null as any,
        { type: 'text', text: 'ok' },
      ]),
    ).toBe(false)
  })

  test('handles undefined blocks in array', () => {
    expect(
      withTruncationCheck(MCPTool).isResultTruncated([undefined as any]),
    ).toBe(false)
  })

  test('returns false for non-string non-array', () => {
    expect(withTruncationCheck(MCPTool).isResultTruncated(42 as any)).toBe(
      false,
    )
    expect(withTruncationCheck(MCPTool).isResultTruncated({} as any)).toBe(
      false,
    )
  })
})
