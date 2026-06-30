import { expect, test } from 'bun:test'

import { handleMessageFromStream, type StreamingToolUse } from './messages.js'
import type { StreamEvent } from '../types/message.js'

// Regression for the PR #1744 change that switched input_json_delta handling
// from filter-then-append to an in-place update. Concurrently-streaming tool
// uses must keep a stable array order (the Messages memo comparator aligns
// streamingToolUses by index), and a delta must only touch its matching entry.

function toolStart(index: number, id: string, name: string): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
  } as unknown as StreamEvent
}

function inputJsonDelta(index: number, partialJson: string): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    },
  } as unknown as StreamEvent
}

function makeHarness() {
  let toolUses: StreamingToolUse[] = []
  const noop = (): void => {}
  const feed = (event: StreamEvent): void =>
    handleMessageFromStream(event, noop, noop, noop, f => {
      toolUses = f(toolUses)
    })
  return { feed, get: () => toolUses }
}

test('interleaved input_json_delta preserves tool order and updates only the matching index', () => {
  const { feed, get } = makeHarness()

  // Three concurrent tool uses start in order 0, 1, 2.
  feed(toolStart(0, 'a', 'toolA'))
  feed(toolStart(1, 'b', 'toolB'))
  feed(toolStart(2, 'c', 'toolC'))

  // Deltas arrive interleaved and out of index order.
  feed(inputJsonDelta(1, '{"x":'))
  feed(inputJsonDelta(0, '{"a":'))
  feed(inputJsonDelta(2, '{"c":'))
  feed(inputJsonDelta(1, '1}'))
  feed(inputJsonDelta(0, '2}'))

  // Order stays start-order, not most-recently-updated order.
  expect(get().map(t => t.index)).toEqual([0, 1, 2])
  expect(get().map(t => t.contentBlock.id)).toEqual(['a', 'b', 'c'])

  // Each entry accumulated only its own deltas.
  expect(get()[0]!.unparsedToolInput).toBe('{"a":2}')
  expect(get()[1]!.unparsedToolInput).toBe('{"x":1}')
  expect(get()[2]!.unparsedToolInput).toBe('{"c":')
})

test('input_json_delta for an unknown index returns the same array reference', () => {
  const { feed, get } = makeHarness()
  feed(toolStart(0, 'a', 'toolA'))

  const before = get()
  feed(inputJsonDelta(7, 'ignored'))

  // found === false → the updater returns the original array unchanged.
  expect(get()).toBe(before)
  expect(get()[0]!.unparsedToolInput).toBe('')
})
