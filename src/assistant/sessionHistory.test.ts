import { describe, expect, test } from 'bun:test'
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKStatusMessage,
  SDKToolProgressMessage,
  SDKUserMessage,
} from '../entrypoints/agentSdkTypes.js'
import {
  deserializeFromCacheMessage,
  serializeToCacheMessage,
} from './sessionHistorySerialization.js'

const resultMessage = {
  type: 'result',
  subtype: 'success',
  duration_ms: 3000,
  duration_api_ms: 2500,
  is_error: false,
  num_turns: 2,
  result: 'Task completed successfully',
  stop_reason: 'end_turn',
  total_cost_usd: 0.02,
  usage: { input_tokens: 200, output_tokens: 100 },
  modelUsage: {},
  permission_denials: [],
  uuid: 'result-uuid',
  session_id: 'session-1',
} satisfies SDKMessage

const statusMessage = {
  type: 'system',
  subtype: 'status',
  status: 'compacting',
  uuid: 'status-uuid',
  session_id: 'session-1',
} satisfies SDKStatusMessage

const toolProgressMessage = {
  type: 'tool_progress',
  tool_use_id: 'tool-use-1',
  tool_name: 'Bash',
  parent_tool_use_id: null,
  elapsed_time_seconds: 0,
  uuid: 'tool-progress-uuid',
  session_id: 'session-1',
} satisfies SDKToolProgressMessage

describe('session history cache serialization', () => {
  test('preserves assistant message variants while encoding array content for cache storage', () => {
    const assistantMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      },
      parent_tool_use_id: null,
      error: 'rate_limit',
      uuid: 'assistant-uuid',
      session_id: 'session-1',
    } satisfies SDKAssistantMessage

    const [serialized] = serializeToCacheMessage([assistantMessage])

    expect(serialized.type).toBe('assistant')
    expect(serialized.contentIsArray).toBe(true)
    expect(serialized.message).toEqual({
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    })
    expect(serialized).not.toHaveProperty('role')
    expect(serialized).not.toHaveProperty('content')

    const [deserialized] = deserializeFromCacheMessage([serialized])

    expect(deserialized).toEqual(assistantMessage)
  })

  test('preserves user message string content without marking it as an array', () => {
    const userMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: 'Hello world',
      },
      parent_tool_use_id: null,
      uuid: 'user-uuid',
      session_id: 'session-1',
    } satisfies SDKUserMessage

    const [serialized] = serializeToCacheMessage([userMessage])

    expect(serialized.contentIsArray).toBeUndefined()
    expect(serialized.message).toEqual({
      role: 'user',
      content: 'Hello world',
    })

    const [deserialized] = deserializeFromCacheMessage([serialized])

    expect(deserialized).toEqual(userMessage)
  })

  test('does not create legacy role or content fields for non-message variants', () => {
    const serialized = serializeToCacheMessage([
      resultMessage,
      statusMessage,
      toolProgressMessage,
    ])

    for (const record of serialized) {
      expect(record).not.toHaveProperty('role')
      expect(record).not.toHaveProperty('content')
    }

    expect(serialized[0]).toEqual({
      ...resultMessage,
      cachedAt: expect.any(Number),
    })
    expect(serialized[1]).toEqual({
      ...statusMessage,
      cachedAt: expect.any(Number),
    })
    expect(serialized[2]).toEqual({
      ...toolProgressMessage,
      cachedAt: expect.any(Number),
    })

    expect(deserializeFromCacheMessage(serialized)).toEqual([
      resultMessage,
      statusMessage,
      toolProgressMessage,
    ])
  })

  test('preserves mixed SDK message variants across cache round trip', () => {
    const assistantMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
      },
      parent_tool_use_id: null,
      uuid: 'assistant-uuid',
      session_id: 'session-1',
    } satisfies SDKAssistantMessage

    const userMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-use-1' }],
      },
      parent_tool_use_id: 'tool-use-1',
      uuid: 'user-uuid',
      session_id: 'session-1',
    } satisfies SDKUserMessage

    const messages: SDKMessage[] = [
      assistantMessage,
      userMessage,
      resultMessage,
      statusMessage,
      toolProgressMessage,
    ]

    const serialized = serializeToCacheMessage(messages)
    const deserialized = deserializeFromCacheMessage(serialized)

    expect(deserialized).toEqual(messages)
  })

  test('preserves SDK user message timestamps across cache round trip', () => {
    const userMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: 'Hello with timestamp',
      },
      parent_tool_use_id: null,
      timestamp: '2026-06-02T17:44:00.000Z',
      uuid: 'timestamped-user-uuid',
      session_id: 'session-1',
    } satisfies SDKUserMessage

    const [serialized] = serializeToCacheMessage([userMessage])

    expect(serialized.timestamp).toBe(userMessage.timestamp)
    expect(serialized.cachedAt).toEqual(expect.any(Number))

    const [deserialized] = deserializeFromCacheMessage([serialized])

    expect(deserialized).toEqual(userMessage)
  })

  test('normalizes legacy top-level cached user and assistant content', () => {
    const legacyContent = [{ type: 'text', text: 'Hello' }]
    const legacyRecords = [
      {
        type: 'assistant',
        role: 'assistant',
        content: JSON.stringify(legacyContent),
        contentIsArray: true,
        timestamp: 123456,
        uuid: 'legacy-assistant-uuid',
        session_id: 'session-1',
      },
      {
        type: 'user',
        role: 'user',
        content: 'Legacy hello',
        contentIsArray: false,
        timestamp: 123456,
        uuid: 'legacy-user-uuid',
        session_id: 'session-1',
      },
    ]

    const deserialized = deserializeFromCacheMessage(legacyRecords)

    expect(deserialized).toEqual([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: legacyContent,
        },
        parent_tool_use_id: null,
        uuid: 'legacy-assistant-uuid',
        session_id: 'session-1',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: 'Legacy hello',
        },
        parent_tool_use_id: null,
        uuid: 'legacy-user-uuid',
        session_id: 'session-1',
      },
    ])
  })
})
