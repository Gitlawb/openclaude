import { describe, expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'

import {
  applyProactiveBudget,
  buildToolUseMap,
  getFilePathFromInput,
  isLargeContent,
  pruneRedundantToolOutputs,
  strippedMarker,
  stripToolResultContent,
} from './proactiveBudget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assistantWithToolUse(
  toolName: string,
  toolId: string,
  input: Record<string, unknown> = {},
): Message {
  return createAssistantMessage({
    content: [
      {
        type: 'tool_use' as const,
        id: toolId,
        name: toolName,
        input,
      },
    ],
  })
}

function userWithToolResult(toolId: string, content: string): Message {
  return createUserMessage({
    content: [
      {
        type: 'tool_result' as const,
        tool_use_id: toolId,
        content,
      },
    ],
  })
}

function userWithToolResultArray(toolId: string, text: string): Message {
  return createUserMessage({
    content: [
      {
        type: 'tool_result' as const,
        tool_use_id: toolId,
        content: [{ type: 'text' as const, text }],
      },
    ],
  })
}

function userTextMessage(text: string): Message {
  return createUserMessage({ content: text })
}

// ---------------------------------------------------------------------------
// buildToolUseMap
// ---------------------------------------------------------------------------

describe('buildToolUseMap', () => {
  test('extracts tool_use blocks from assistant messages', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'content'),
      assistantWithToolUse('Bash', 'tool-2', { command: 'ls' }),
    ]

    const map = buildToolUseMap(messages)
    expect(map.size).toBe(2)
    expect(map.get('tool-1')!.name).toBe('Read')
    expect(map.get('tool-1')!.input).toEqual({ file_path: '/a.ts' })
    expect(map.get('tool-2')!.name).toBe('Bash')
    expect(map.get('tool-2')!.input).toEqual({ command: 'ls' })
  })

  test('skips non-assistant messages', () => {
    const map = buildToolUseMap([userWithToolResult('t1', 'x'), userTextMessage('hi')])
    expect(map.size).toBe(0)
  })

  test('skips content blocks that are not tool_use', () => {
    const map = buildToolUseMap([
      createAssistantMessage({ content: [{ type: 'text' as const, text: 'hello' }] }),
    ])
    expect(map.size).toBe(0)
  })

  test('handles tool_use blocks with non-string id (empty string is still a string)', () => {
    // typeof '' === 'string' is true, so empty-string id IS added
    const msg = createAssistantMessage({
      content: [
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
        { type: 'tool_use' as const, id: '' as any, name: 'Read', input: {} },
      ],
    })

    const map = buildToolUseMap([msg])
    // Both blocks have typeof id === 'string', both are valid
    expect(map.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// getFilePathFromInput
// ---------------------------------------------------------------------------

describe('getFilePathFromInput', () => {
  test('extracts file_path from input', () => {
    expect(getFilePathFromInput({ file_path: '/a.ts' })).toBe('/a.ts')
  })

  test('returns undefined when file_path is missing', () => {
    expect(getFilePathFromInput({})).toBeUndefined()
  })

  test('returns undefined when file_path is empty string', () => {
    expect(getFilePathFromInput({ file_path: '' })).toBeUndefined()
  })

  test('returns undefined when file_path is not a string', () => {
    expect(getFilePathFromInput({ file_path: 42 })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isLargeContent
// ---------------------------------------------------------------------------

describe('isLargeContent', () => {
  test('returns true for string content > 200 chars', () => {
    expect(isLargeContent('x'.repeat(201))).toBe(true)
  })

  test('returns false for string content <= 200 chars', () => {
    expect(isLargeContent('x'.repeat(200))).toBe(false)
    expect(isLargeContent('small error')).toBe(false)
    expect(isLargeContent('')).toBe(false)
  })

  test('returns true for array content with total text > 200 chars', () => {
    expect(isLargeContent([{ type: 'text' as const, text: 'x'.repeat(201) }])).toBe(true)
  })

  test('returns false for array content with total text <= 200 chars', () => {
    expect(isLargeContent([{ type: 'text' as const, text: 'small' }])).toBe(false)
  })

  test('returns false for non-string non-array content', () => {
    expect(isLargeContent(null)).toBe(false)
    expect(isLargeContent(undefined)).toBe(false)
    expect(isLargeContent(42)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// stripToolResultContent
// ---------------------------------------------------------------------------

describe('stripToolResultContent', () => {
  test('replaces string content with marker', () => {
    const block = { type: 'tool_result', tool_use_id: 't1', content: 'old content' }
    stripToolResultContent(block, '/a.ts')
    expect(block.content).toBe(strippedMarker('/a.ts'))
  })

  test('replaces array content with marker array', () => {
    const block = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: [{ type: 'text', text: 'old content' }],
    }
    stripToolResultContent(block, '/b.ts')
    expect(Array.isArray(block.content)).toBe(true)
    expect((block.content as Array<{ text: string }>)[0]!.text).toBe(strippedMarker('/b.ts'))
  })
})

// ---------------------------------------------------------------------------
// pruneRedundantToolOutputs
// ---------------------------------------------------------------------------

describe('pruneRedundantToolOutputs', () => {
  test('strips old Read result when same file is re-read', () => {
    // Turn 1: Read /a.ts, Turn 2: Read /a.ts again
    // Old (turn 1) should be stripped, new (turn 2) preserved
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(1)
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe(strippedMarker('/a.ts'))
    expect(
      (result[3]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('y'.repeat(500))
  })

  test('keeps most recent per file across multiple files', () => {
    // Read A, Read B, Read A → first Read A stripped, Read B kept, second Read A kept
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/b.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
      assistantWithToolUse('Read', 'tool-3', { file_path: '/a.ts' }),
      userWithToolResult('tool-3', 'z'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(1)
    // First Read of /a.ts stripped
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe(strippedMarker('/a.ts'))
    // Read of /b.ts preserved
    expect(
      (result[3]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('y'.repeat(500))
    // Second Read of /a.ts preserved
    expect(
      (result[5]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('z'.repeat(500))
  })

  test('preserves different files read once each', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/b.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(0)
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('x'.repeat(500))
    expect(
      (result[3]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('y'.repeat(500))
  })

  test('does not strip non-file tools (Bash, Grep)', () => {
    const messages: Message[] = [
      assistantWithToolUse('Bash', 'tool-1', { command: 'ls' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Bash', 'tool-2', { command: 'ls -la' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(0)
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('x'.repeat(500))
    expect(
      (result[3]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('y'.repeat(500))
  })

  test('Write supersedes Read for same file', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Write', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(1)
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe(strippedMarker('/a.ts'))
    expect(
      (result[3]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('y'.repeat(500))
  })

  test('Edit supersedes Read for same file', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Edit', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(1)
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe(strippedMarker('/a.ts'))
    expect(
      (result[3]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('y'.repeat(500))
  })

  test('does not strip small content (< 200 chars)', () => {
    // First Read of /a.ts has small content → not stripped even though newer result exists
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'File not found'),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(0)
    expect(
      (result[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe('File not found')
  })

  test('handles array-format tool results', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResultArray('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResultArray('tool-2', 'y'.repeat(500)),
    ]

    const map = buildToolUseMap(messages)
    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, map)

    expect(strippedCount).toBe(1)
    const oldContent = (result[1]!.message.content as Array<{ content: Array<{ text: string }> }>)[0]!.content
    expect(Array.isArray(oldContent)).toBe(true)
    expect((oldContent as Array<{ text: string }>)[0]!.text).toBe(strippedMarker('/a.ts'))

    const newContent = (result[3]!.message.content as Array<{ content: Array<{ text: string }> }>)[0]!.content
    expect(Array.isArray(newContent)).toBe(true)
    expect((newContent as Array<{ text: string }>)[0]!.text).toBe('y'.repeat(500))
  })

  test('handles empty messages array', () => {
    const { messages, strippedCount } = pruneRedundantToolOutputs([], new Map())
    expect(messages).toEqual([])
    expect(strippedCount).toBe(0)
  })

  test('handles messages with no tool results', () => {
    const messages: Message[] = [
      userTextMessage('hello'),
      createAssistantMessage({ content: 'world' }),
    ]

    const { messages: result, strippedCount } = pruneRedundantToolOutputs(messages, new Map())
    expect(strippedCount).toBe(0)
    expect(result).toEqual(messages)
  })

  test('does not mutate original messages when stripping', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const originalContent = (messages[1]!.message.content as Array<{ content: string }>)[0]!.content
    pruneRedundantToolOutputs(messages, buildToolUseMap(messages))

    expect(
      (messages[1]!.message.content as Array<{ content: string }>)[0]!.content,
    ).toBe(originalContent)
  })
})

// ---------------------------------------------------------------------------
// applyProactiveBudget (config-driven integration)
//
// applyProactiveBudget reads proactiveBudgetLimit from user config.
// 0 or undefined = disabled. Positive number = target token budget.
// The pruning logic itself is tested above via pruneRedundantToolOutputs.
// ---------------------------------------------------------------------------

describe('applyProactiveBudget', () => {
  test('no-op when config limit is not set (default = disabled)', () => {
    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-1', { file_path: '/a.ts' }),
      userWithToolResult('tool-1', 'x'.repeat(500)),
      assistantWithToolUse('Read', 'tool-2', { file_path: '/a.ts' }),
      userWithToolResult('tool-2', 'y'.repeat(500)),
    ]

    const result = applyProactiveBudget(messages)

    expect(result.wasPruned).toBe(false)
    expect(result.strippedCount).toBe(0)
    expect(result.messages).toBe(messages)
  })
})
