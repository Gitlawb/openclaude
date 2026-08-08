import { expect, test } from 'bun:test'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  createAssistantMessage,
  createUserMessage,
  ensureToolResultPairing,
} from '../messages.js'
import {
  selectToolPairSafeMessageRange,
  validateToolResultPairing,
} from './toolPairing.js'

function assistantWithToolUses(...ids: string[]) {
  return createAssistantMessage({
    content: ids.map(
      id =>
        ({
          type: 'tool_use',
          id,
          name: 'Read',
          input: { file_path: '/tmp/example.txt' },
        }) as BetaContentBlock,
    ),
  })
}

function userWithToolResults(...ids: string[]) {
  return createUserMessage({
    content: ids.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: `result for ${id}`,
    })),
  })
}

test('validateToolResultPairing accepts paired tool uses and results', () => {
  const assistant = assistantWithToolUses('toolu_ok')
  const user = userWithToolResults('toolu_ok')

  const result = validateToolResultPairing([assistant, user], {
    phase: 'api_before_repair',
  })

  expect(result.valid).toBe(true)
  expect(result.issues).toEqual([])
})

test('validateToolResultPairing reports missing tool results with phase metadata', () => {
  const assistant = assistantWithToolUses('toolu_missing')

  const result = validateToolResultPairing([assistant], {
    phase: 'api_before_repair',
    querySource: 'repl_main_thread',
    model: 'glm-5.1',
    provider: 'openai',
  })

  expect(result.valid).toBe(false)
  expect(result.context).toEqual({
    phase: 'api_before_repair',
    querySource: 'repl_main_thread',
    model: 'glm-5.1',
    provider: 'openai',
  })
  expect(result.issues).toEqual([
    {
      kind: 'missing_tool_result',
      toolUseId: 'toolu_missing',
      assistantIndex: 0,
      assistantMessageId: assistant.message.id,
    },
  ])
})

test('validateToolResultPairing reports orphaned tool results', () => {
  const user = userWithToolResults('toolu_orphan')

  const result = validateToolResultPairing([user], {
    phase: 'resume_before_api_repair',
  })

  expect(result.valid).toBe(false)
  expect(result.issues).toEqual([
    {
      kind: 'orphaned_tool_result',
      toolUseId: 'toolu_orphan',
      userIndex: 0,
    },
  ])
})

test('validateToolResultPairing reports duplicate tool uses across assistant messages', () => {
  const first = assistantWithToolUses('toolu_duplicate')
  const firstResult = userWithToolResults('toolu_duplicate')
  const second = assistantWithToolUses('toolu_duplicate')
  const secondResult = userWithToolResults('toolu_duplicate')

  const result = validateToolResultPairing([
    first,
    firstResult,
    second,
    secondResult,
  ])

  expect(result.valid).toBe(false)
  expect(result.issues).toContainEqual({
    kind: 'duplicate_tool_use',
    toolUseId: 'toolu_duplicate',
    assistantIndex: 2,
    assistantMessageId: second.message.id,
    duplicateOfAssistantIndex: 0,
    duplicateOfAssistantMessageId: first.message.id,
  })
})

test('validateToolResultPairing reports duplicate tool results in the paired user message', () => {
  const assistant = assistantWithToolUses('toolu_duplicate_result')
  const user = userWithToolResults(
    'toolu_duplicate_result',
    'toolu_duplicate_result',
  )

  const result = validateToolResultPairing([assistant, user])

  expect(result.valid).toBe(false)
  expect(result.issues).toContainEqual({
    kind: 'duplicate_tool_result',
    toolUseId: 'toolu_duplicate_result',
    assistantIndex: 0,
    assistantMessageId: assistant.message.id,
    userIndex: 1,
  })
})

test('validateToolResultPairing reports server tool uses without in-message results', () => {
  const assistant = createAssistantMessage({
    content: [
      {
        type: 'server_tool_use',
        id: 'srvu_missing',
        name: 'web_search',
        input: { query: 'openclaude' },
      } as unknown as BetaContentBlock,
    ],
  })

  const result = validateToolResultPairing([assistant], {
    phase: 'api_before_repair',
  })

  expect(result.valid).toBe(false)
  expect(result.issues).toContainEqual({
    kind: 'server_tool_use_without_result',
    toolUseId: 'srvu_missing',
    assistantIndex: 0,
    assistantMessageId: assistant.message.id,
  })
})

test('ensureToolResultPairing keeps repairing legacy mismatches', () => {
  const assistant = assistantWithToolUses('toolu_missing')

  const repaired = ensureToolResultPairing([assistant], {
    phase: 'api_before_repair',
  })

  expect(repaired).toHaveLength(2)
  expect(repaired[1]?.type).toBe('user')
  const content = repaired[1]?.message.content
  expect(Array.isArray(content)).toBe(true)
  expect(Array.isArray(content) ? content[0] : undefined).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'toolu_missing',
    is_error: true,
  })
})

test('selectToolPairSafeMessageRange expands a tool_result start boundary backward', () => {
  const preamble = createUserMessage({ content: 'older context' })
  const assistant = assistantWithToolUses('toolu_window_start')
  const result = userWithToolResults('toolu_window_start')
  const tail = createUserMessage({ content: 'current request' })

  const selected = selectToolPairSafeMessageRange(
    [preamble, assistant, result, tail],
    2,
    4,
    { projectionName: 'away_summary', querySource: 'away_summary' },
  )

  expect(selected.start).toBe(1)
  expect(selected.end).toBe(4)
  expect(selected.messages).toEqual([assistant, result, tail])
  expect(selected.diagnostics.requestedStartedWithToolResult).toBe(true)
  expect(selected.diagnostics.issueKinds).toContain('orphaned_tool_result')
  expect(validateToolResultPairing(selected.messages).valid).toBe(true)
})

test('selectToolPairSafeMessageRange expands an assistant tool_use end boundary forward', () => {
  const head = createUserMessage({ content: 'older context' })
  const assistant = assistantWithToolUses('toolu_window_end')
  const result = userWithToolResults('toolu_window_end')
  const tail = createUserMessage({ content: 'current request' })

  const selected = selectToolPairSafeMessageRange(
    [head, assistant, result, tail],
    0,
    2,
    { projectionName: 'partial_compact', querySource: 'compact' },
  )

  expect(selected.start).toBe(0)
  expect(selected.end).toBe(3)
  expect(selected.messages).toEqual([head, assistant, result])
  expect(selected.diagnostics.issueKinds).toContain('missing_tool_result')
  expect(validateToolResultPairing(selected.messages).valid).toBe(true)
})

test('selectToolPairSafeMessageRange keeps multi-tool assistant messages with their results', () => {
  const assistant = assistantWithToolUses('toolu_multi_a', 'toolu_multi_b')
  const result = userWithToolResults('toolu_multi_a', 'toolu_multi_b')
  const tail = createUserMessage({ content: 'current request' })

  const selected = selectToolPairSafeMessageRange(
    [assistant, result, tail],
    0,
    1,
    { projectionName: 'summary_window', querySource: 'away_summary' },
  )

  expect(selected.messages).toEqual([assistant, result])
  expect(selected.diagnostics.issueKinds).toContain('missing_tool_result')
  expect(validateToolResultPairing(selected.messages).valid).toBe(true)
})

test('selectToolPairSafeMessageRange diagnostics omit raw message content', () => {
  const assistant = assistantWithToolUses('toolu_secret')
  const result = userWithToolResults('toolu_secret')

  const selected = selectToolPairSafeMessageRange([assistant, result], 1, 2, {
    projectionName: 'away_summary',
    querySource: 'away_summary',
  })

  expect(selected.diagnostics.projectionName).toBe('away_summary')
  expect(selected.diagnostics.querySource).toBe('away_summary')
  expect(selected.diagnostics.requestedRange).toEqual({ start: 1, end: 2 })
  expect(selected.diagnostics.adjustedRange).toEqual({ start: 0, end: 2 })
  expect(JSON.stringify(selected.diagnostics)).not.toContain('result for')
})

test('selectToolPairSafeMessageRange does not re-expand across a dropped orphaned tool_result', () => {
  const earlierAssistantPart = createAssistantMessage({
    content: [{ type: 'text', text: 'thinking', citations: [] }],
  })
  const laterAssistantPart = createAssistantMessage({
    content: [{ type: 'text', text: 'continuing', citations: [] }],
  })
  laterAssistantPart.message.id = earlierAssistantPart.message.id
  const orphanedResult = userWithToolResults('toolu_unavailable')
  const tail = createUserMessage({ content: 'current request' })

  const selected = selectToolPairSafeMessageRange(
    [earlierAssistantPart, orphanedResult, laterAssistantPart, tail],
    1,
    4,
    { projectionName: 'away_summary', querySource: 'away_summary' },
  )

  expect(selected.start).toBe(3)
  expect(selected.messages).toEqual([tail])
  expect(validateToolResultPairing(selected.messages).valid).toBe(true)
})

test('selectToolPairSafeMessageRange still expands available results when pending tool uses are allowed', () => {
  const head = createUserMessage({ content: 'older context' })
  const assistant = assistantWithToolUses('toolu_pending_allowed')
  const result = userWithToolResults('toolu_pending_allowed')

  const selected = selectToolPairSafeMessageRange([head, assistant, result], 0, 2, {
    projectionName: 'live_turn',
    querySource: 'repl_main_thread',
    allowPendingToolUse: true,
  })

  expect(selected.messages).toEqual([head, assistant, result])
  expect(validateToolResultPairing(selected.messages).valid).toBe(true)
})

test('selectToolPairSafeMessageRange does not treat out-of-range results as pending tool uses', () => {
  const head = createUserMessage({ content: 'older context' })
  const assistant = assistantWithToolUses('toolu_not_pending')
  const filler = createUserMessage({ content: 'filler' })
  const result = userWithToolResults('toolu_not_pending')

  const selected = selectToolPairSafeMessageRange(
    [head, assistant, filler, result],
    0,
    2,
    {
      projectionName: 'live_turn',
      querySource: 'repl_main_thread',
      allowPendingToolUse: true,
      maxExtraMessages: 0,
    },
  )

  expect(selected.messages).toEqual([head])
  expect(validateToolResultPairing(selected.messages).valid).toBe(true)
})

test('selectToolPairSafeMessageRange drops a partial assistant group when the earlier sibling is outside the expansion budget', () => {
  const earlierAssistantPart = createAssistantMessage({
    content: [{ type: 'text', text: 'thinking', citations: [] }],
  })
  const filler = createUserMessage({ content: 'filler' })
  const laterAssistantPart = createAssistantMessage({
    content: [{ type: 'text', text: 'continuing', citations: [] }],
  })
  laterAssistantPart.message.id = earlierAssistantPart.message.id
  const tail = createUserMessage({ content: 'current request' })

  const selected = selectToolPairSafeMessageRange(
    [earlierAssistantPart, filler, laterAssistantPart, tail],
    2,
    4,
    {
      projectionName: 'away_summary',
      querySource: 'away_summary',
      maxExtraMessages: 0,
    },
  )

  expect(selected.messages).toEqual([tail])
})

test('selectToolPairSafeMessageRange drops a partial assistant group when the later sibling is outside the expansion budget', () => {
  const head = createUserMessage({ content: 'older context' })
  const earlierAssistantPart = createAssistantMessage({
    content: [{ type: 'text', text: 'thinking', citations: [] }],
  })
  const filler = createUserMessage({ content: 'filler' })
  const laterAssistantPart = createAssistantMessage({
    content: [{ type: 'text', text: 'continuing', citations: [] }],
  })
  laterAssistantPart.message.id = earlierAssistantPart.message.id

  const selected = selectToolPairSafeMessageRange(
    [head, earlierAssistantPart, filler, laterAssistantPart],
    0,
    2,
    {
      projectionName: 'partial_compact',
      querySource: 'compact',
      maxExtraMessages: 0,
    },
  )

  expect(selected.messages).toEqual([head])
})
