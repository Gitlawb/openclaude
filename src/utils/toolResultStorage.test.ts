import { expect, test } from 'bun:test'

import { createUserMessage } from './messages.ts'
import {
  applyToolResultReplacementsToMessages,
  buildLargeToolResultMessage,
  filterContentReplacementsForMessages,
} from './toolResultStorage.ts'

const baseResult = {
  filepath: '/tmp/tool-results/abc.txt',
  originalSize: 100_000,
  isJson: false,
  preview: 'first chunk',
  hasMore: true,
}

test('buildLargeToolResultMessage says "Full output" when the file is complete', () => {
  const message = buildLargeToolResultMessage(baseResult)
  expect(message).toContain('Full output saved to: /tmp/tool-results/abc.txt')
  expect(message).not.toContain('capped')
})

test('buildLargeToolResultMessage avoids "Full output" wording when the file was capped', () => {
  const message = buildLargeToolResultMessage({ ...baseResult, truncated: true })
  expect(message).not.toContain('Full output')
  expect(message).toContain('Partial output saved to: /tmp/tool-results/abc.txt')
  expect(message).toContain('capped')
})

test('applyToolResultReplacementsToMessages replaces matching tool results and preserves unrelated messages', () => {
  const unrelated = createUserMessage({ content: 'keep me' })
  const oversizedResult = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'very large tool output',
        is_error: false,
      },
    ],
    toolUseResult: {
      stdout: 'very large tool output',
      stderr: '',
    },
  })
  const messages = [unrelated, oversizedResult]
  const replacement =
    '<persisted-output>\nOutput too large. Preview\n</persisted-output>'

  const next = applyToolResultReplacementsToMessages(
    messages,
    new Map([['tool-1', replacement]]),
  )

  expect(next).not.toBe(messages)
  expect(next[0]).toBe(unrelated)
  expect(next[1]).not.toBe(oversizedResult)
  expect((next[1]!.message.content as Array<{ content: string }>)[0]!.content).toBe(
    replacement,
  )
  expect(next[1]!.toolUseResult).toBeUndefined()
})

test('applyToolResultReplacementsToMessages is idempotent when messages are already hydrated', () => {
  const hydrated = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: '<persisted-output>\nPreview\n</persisted-output>',
        is_error: false,
      },
    ],
  })
  const messages = [hydrated]

  const next = applyToolResultReplacementsToMessages(
    messages,
    new Map([['tool-1', '<persisted-output>\nPreview\n</persisted-output>']]),
  )

  expect(next).toBe(messages)
})

test('filterContentReplacementsForMessages keeps only records for retained tool results', () => {
  const retained = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'large retained output',
        is_error: false,
      },
    ],
  })
  const kept = {
    kind: 'tool-result' as const,
    toolUseId: 'tool-1',
    replacement: '[retained preview]',
  }

  expect(
    filterContentReplacementsForMessages([retained], [
      kept,
      {
        kind: 'tool-result',
        toolUseId: 'tool-2',
        replacement: '[dropped preview]',
      },
    ]),
  ).toEqual([kept])
})
