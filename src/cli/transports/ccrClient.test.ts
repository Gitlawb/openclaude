import { describe, expect, test } from 'bun:test'
import type { SDKPartialAssistantMessage } from 'src/entrypoints/sdk/controlTypes.js'
import {
  accumulateStreamEvents,
  createStreamAccumulator,
} from './ccrClient.js'

describe('accumulateStreamEvents', () => {
  test('coalesces text deltas into one full-so-far snapshot per content block', () => {
    const state = createStreamAccumulator()
    const messageStart = streamMessage('start', {
      type: 'message_start',
      message: { id: 'msg_1' },
    })
    const firstDelta = streamMessage('delta-1', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hel' },
    })
    const secondDelta = streamMessage('delta-2', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'lo' },
    })

    expect(
      accumulateStreamEvents([messageStart, firstDelta, secondDelta], state),
    ).toEqual([
      messageStart,
      {
        type: 'stream_event',
        uuid: 'delta-1',
        session_id: 'session-1',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        },
      },
    ])
  })

  test('coalesces interleaved text deltas independently by content block index', () => {
    const state = createStreamAccumulator()
    const messageStart = streamMessage('start', {
      type: 'message_start',
      message: { id: 'msg_1' },
    })

    const result = accumulateStreamEvents(
      [
        messageStart,
        streamMessage('block-0-a', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'he' },
        }),
        streamMessage('block-1-a', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'wo' },
        }),
        streamMessage('block-0-b', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'llo' },
        }),
        streamMessage('block-1-b', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'rld' },
        }),
      ],
      state,
    )

    expect(result).toHaveLength(3)
    expect(result).toEqual([
      messageStart,
      {
        type: 'stream_event',
        uuid: 'block-0-a',
        session_id: 'session-1',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        },
      },
      {
        type: 'stream_event',
        uuid: 'block-1-a',
        session_id: 'session-1',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'world' },
        },
      },
    ])
  })

  test('isolates text delta accumulation by session and parent tool scope', () => {
    const state = createStreamAccumulator()
    const rootStart = streamMessage('root-start', {
      type: 'message_start',
      message: { id: 'msg_root' },
    })
    const parentStart = streamMessage(
      'parent-start',
      {
        type: 'message_start',
        message: { id: 'msg_parent' },
      },
      { parent_tool_use_id: 'tool-1' },
    )
    const otherSessionStart = streamMessage(
      'other-session-start',
      {
        type: 'message_start',
        message: { id: 'msg_other_session' },
      },
      { session_id: 'session-2' },
    )

    const result = accumulateStreamEvents(
      [
        rootStart,
        streamMessage('root-a', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'root-' },
        }),
        parentStart,
        streamMessage(
          'parent-a',
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'parent-' },
          },
          { parent_tool_use_id: 'tool-1' },
        ),
        otherSessionStart,
        streamMessage(
          'other-session-a',
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'other-' },
          },
          { session_id: 'session-2' },
        ),
        streamMessage('root-b', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'scope' },
        }),
        streamMessage(
          'parent-b',
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'scope' },
          },
          { parent_tool_use_id: 'tool-1' },
        ),
        streamMessage(
          'other-session-b',
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'scope' },
          },
          { session_id: 'session-2' },
        ),
      ],
      state,
    )

    expect(result).toEqual([
      rootStart,
      {
        type: 'stream_event',
        uuid: 'root-a',
        session_id: 'session-1',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'root-scope' },
        },
      },
      parentStart,
      {
        type: 'stream_event',
        uuid: 'parent-a',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'parent-scope' },
        },
      },
      otherSessionStart,
      {
        type: 'stream_event',
        uuid: 'other-session-a',
        session_id: 'session-2',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'other-scope' },
        },
      },
    ])
  })

  test('resets scoped accumulation when a new message starts', () => {
    const state = createStreamAccumulator()
    const firstStart = streamMessage('first-start', {
      type: 'message_start',
      message: { id: 'msg_first' },
    })
    const secondStart = streamMessage('second-start', {
      type: 'message_start',
      message: { id: 'msg_second' },
    })

    const result = accumulateStreamEvents(
      [
        firstStart,
        streamMessage('first-delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'first' },
        }),
        secondStart,
        streamMessage('second-delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'second' },
        }),
      ],
      state,
    )

    expect(result).toEqual([
      firstStart,
      {
        type: 'stream_event',
        uuid: 'first-delta',
        session_id: 'session-1',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'first' },
        },
      },
      secondStart,
      {
        type: 'stream_event',
        uuid: 'second-delta',
        session_id: 'session-1',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'second' },
        },
      },
    ])
    expect(state.byMessage.has('msg_first')).toBe(false)
    expect(state.byMessage.has('msg_second')).toBe(true)
  })

  test('passes malformed or non-text content deltas through unchanged', () => {
    const state = createStreamAccumulator()
    const malformedDelta = streamMessage('malformed-delta', {
      type: 'content_block_delta',
      index: 0,
      delta: null,
    })
    const imageDelta = streamMessage('image-delta', {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    })

    expect(accumulateStreamEvents([malformedDelta, imageDelta], state)).toEqual([
      malformedDelta,
      imageDelta,
    ])
  })
})

function streamMessage(
  uuid: string,
  event: Record<string, unknown>,
  overrides: Partial<
    Pick<SDKPartialAssistantMessage, 'parent_tool_use_id' | 'session_id'>
  > = {},
): SDKPartialAssistantMessage {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    uuid,
    session_id: 'session-1',
    ...overrides,
  }
}
