import { expect, test } from 'bun:test'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  createAssistantMessage,
  createUserMessage,
  ensureToolResultPairing,
  validateToolResultPairing,
} from './messages.js'

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
