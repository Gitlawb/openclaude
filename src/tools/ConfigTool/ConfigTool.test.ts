import { describe, expect, test } from 'bun:test'
import { ConfigTool } from './ConfigTool.js'

// ---------------------------------------------------------------------------
// mapToolResultToToolResultBlockParam — rendering of set/clear results
// ---------------------------------------------------------------------------

describe('ConfigTool.mapToolResultToToolResultBlockParam', () => {
  const toolUseID = 'test-id'

  test('renders set result using newValue', () => {
    const result = ConfigTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        operation: 'set',
        setting: 'compactModel',
        newValue: 'claude-sonnet-4-6',
      },
      toolUseID,
    )
    expect(result.content).toBe('Set compactModel to "claude-sonnet-4-6"')
  })

  test('clearable "default" result renders Set…to null, not undefined', () => {
    // Regression: clearable branch previously returned value:null without newValue,
    // causing mapToolResultToToolResultBlockParam to render "Set compactModel to undefined".
    const result = ConfigTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        operation: 'set',
        setting: 'compactModel',
        newValue: null,
      },
      toolUseID,
    )
    expect(result.content).toBe('Set compactModel to null')
    expect(result.content).not.toContain('undefined')
  })

  test('renders get result using value', () => {
    const result = ConfigTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        operation: 'get',
        setting: 'compactModel',
        value: 'claude-opus-4-8',
      },
      toolUseID,
    )
    expect(result.content).toBe('compactModel = "claude-opus-4-8"')
  })

  test('renders error result', () => {
    const result = ConfigTool.mapToolResultToToolResultBlockParam(
      { success: false, error: 'Unknown setting: "foo"' },
      toolUseID,
    )
    expect(result.content).toBe('Error: Unknown setting: "foo"')
    expect(result.is_error).toBe(true)
  })
})
