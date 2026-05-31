import { expect, test, describe } from 'bun:test'

import { createUserMessage } from './messages.ts'
import {
  applyToolResultReplacementsToMessages,
  createContentReplacementState,
  pruneContentReplacementState,
} from './toolResultStorage.ts'

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

describe('pruneContentReplacementState', () => {
  function makeToolResultMessage(toolUseId: string) {
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'output',
          is_error: false,
        },
      ],
    })
  }

  test('evicts seenIds and replacements not present in surviving messages', () => {
    const state = createContentReplacementState()
    state.seenIds.add('old-tool-1')
    state.seenIds.add('old-tool-2')
    state.seenIds.add('kept-tool-1')
    state.replacements.set('old-tool-1', '<persisted-output>stale preview</persisted-output>')
    state.replacements.set('kept-tool-1', '<persisted-output>live preview</persisted-output>')

    const surviving = [makeToolResultMessage('kept-tool-1')]
    pruneContentReplacementState(state, surviving)

    // Stale IDs removed
    expect(state.seenIds.has('old-tool-1')).toBe(false)
    expect(state.seenIds.has('old-tool-2')).toBe(false)
    expect(state.replacements.has('old-tool-1')).toBe(false)

    // Surviving ID kept
    expect(state.seenIds.has('kept-tool-1')).toBe(true)
    expect(state.replacements.get('kept-tool-1')).toBe('<persisted-output>live preview</persisted-output>')
  })

  test('clears everything when no surviving messages have tool results', () => {
    const state = createContentReplacementState()
    state.seenIds.add('pre-compact-1')
    state.seenIds.add('pre-compact-2')
    state.replacements.set('pre-compact-1', '<persisted-output>gone</persisted-output>')

    // Post-compact messages are just the boundary marker (no tool_results)
    const surviving = [createUserMessage({ content: 'compact summary' })]
    pruneContentReplacementState(state, surviving)

    expect(state.seenIds.size).toBe(0)
    expect(state.replacements.size).toBe(0)
  })

  test('is a no-op when state is already empty', () => {
    const state = createContentReplacementState()
    const surviving = [makeToolResultMessage('tool-1')]
    // Should not throw
    pruneContentReplacementState(state, surviving)
    expect(state.seenIds.size).toBe(0)
    expect(state.replacements.size).toBe(0)
  })

  test('retains all entries when all tool_use_ids survive compaction', () => {
    const state = createContentReplacementState()
    state.seenIds.add('tool-a')
    state.seenIds.add('tool-b')
    state.replacements.set('tool-a', '<persisted-output>a</persisted-output>')
    state.replacements.set('tool-b', '<persisted-output>b</persisted-output>')

    const surviving = [
      makeToolResultMessage('tool-a'),
      makeToolResultMessage('tool-b'),
    ]
    pruneContentReplacementState(state, surviving)

    expect(state.seenIds.size).toBe(2)
    expect(state.replacements.size).toBe(2)
  })

  test('handles mixed surviving/stale across multiple compaction cycles', () => {
    // Simulate accumulation across two compaction cycles
    const state = createContentReplacementState()
    // Cycle 1 (all stale after second compact)
    state.seenIds.add('cycle1-tool-1')
    state.seenIds.add('cycle1-tool-2')
    state.replacements.set('cycle1-tool-1', '<persisted-output>old</persisted-output>')
    // Cycle 2 (still live)
    state.seenIds.add('cycle2-tool-1')
    state.replacements.set('cycle2-tool-1', '<persisted-output>live</persisted-output>')

    const surviving = [makeToolResultMessage('cycle2-tool-1')]
    pruneContentReplacementState(state, surviving)

    expect(state.seenIds.size).toBe(1)
    expect(state.seenIds.has('cycle2-tool-1')).toBe(true)
    expect(state.replacements.size).toBe(1)
    expect(state.replacements.has('cycle2-tool-1')).toBe(true)
  })
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
