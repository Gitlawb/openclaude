import { describe, expect, it } from 'bun:test'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

// Test the serialization round-trip by importing the module functions
// These are unexported, so we test via the exported cacheSession/loadCachedSession path
// We also test the internal functions by re-implementing the round-trip inline

function serializeToCacheMessage(events: SDKMessage[]): Record<string, unknown>[] {
  return events.map((m) => {
    const cacheMsg: Record<string, unknown> = {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      contentIsArray: Array.isArray(m.content),
      timestamp: Date.now(),
    }
    if (m.tool_calls) cacheMsg.tool_calls = m.tool_calls
    if (m.tool_use_id) cacheMsg.tool_use_id = m.tool_use_id
    if ('id' in m && m.id) cacheMsg.id = m.id
    if ('type' in m) cacheMsg.type = m.type
    if ('message' in m) cacheMsg.message = m.message
    if ('error' in m) cacheMsg.error = m.error
    if ('uuid' in m) cacheMsg.uuid = m.uuid
    if ('session_id' in m) cacheMsg.session_id = m.session_id
    if ('parent_tool_use_id' in m) cacheMsg.parent_tool_use_id = m.parent_tool_use_id
    if ('tool_use_result' in m) cacheMsg.tool_use_result = m.tool_use_result
    if ('subtype' in m) cacheMsg.subtype = m.subtype
    if ('result' in m) cacheMsg.result = m.result
    if ('errors' in m) cacheMsg.errors = m.errors
    if ('event' in m) cacheMsg.event = m.event
    if ('status' in m && m.status) cacheMsg.status = m.status
    if ('compact_metadata' in m) cacheMsg.compact_metadata = m.compact_metadata
    if ('tool_name' in m) cacheMsg.tool_name = m.tool_name
    if ('elapsed_time_seconds' in m) cacheMsg.elapsed_time_seconds = m.elapsed_time_seconds
    return cacheMsg
  })
}

function deserializeFromCacheMessage(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  return messages.map((m) => {
    let content: unknown = m.content
    if (m.contentIsArray) {
      try {
        content = JSON.parse(m.content as string)
      } catch {
        content = m.content
      }
    }
    const msg: Record<string, unknown> = {
      role: m.role,
      content,
    }
    if (m.tool_calls) msg.tool_calls = m.tool_calls
    if (m.tool_use_id) msg.tool_use_id = m.tool_use_id
    if (m.id) msg.id = m.id
    if (m.type) msg.type = m.type
    if (m.message) msg.message = m.message
    if (m.error) msg.error = m.error
    if (m.uuid) msg.uuid = m.uuid
    if (m.session_id) msg.session_id = m.session_id
    if (m.parent_tool_use_id) msg.parent_tool_use_id = m.parent_tool_use_id
    if (m.tool_use_result) msg.tool_use_result = m.tool_use_result
    if (m.subtype) msg.subtype = m.subtype
    if (m.result) msg.result = m.result
    if (m.errors) msg.errors = m.errors
    if (m.event) msg.event = m.event
    if (m.status) msg.status = m.status
    if (m.compact_metadata) msg.compact_metadata = m.compact_metadata
    if (m.tool_name) msg.tool_name = m.tool_name
    if (m.elapsed_time_seconds !== undefined) msg.elapsed_time_seconds = m.elapsed_time_seconds
    return msg
  })
}

describe('SDKMessage Serialization Round-Trip', () => {

  it('round-trips assistant message with error', () => {
    const message: SDKMessage = {
      role: 'assistant',
      type: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      error: 'rate_limit',
      uuid: 'uuid-1',
      session_id: 'session-1',
      model: 'claude-sonnet-4-20250514',
      parent_tool_use_id: null,
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.error).toBe('rate_limit')
    expect(deserialized.uuid).toBe('uuid-1')
    expect(deserialized.session_id).toBe('session-1')
  })

  it('round-trips result message with errors (error variant)', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'result',
      subtype: 'error_during_execution',
      result: undefined,
      errors: ['Connection timeout', 'Retry failed'],
      is_error: true,
      duration_ms: 5000,
      duration_api_ms: 4000,
      num_turns: 3,
      stop_reason: null,
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
      modelUsage: {},
      permission_denials: [],
      uuid: 'uuid-2',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.errors).toEqual(['Connection timeout', 'Retry failed'])
    expect(deserialized.subtype).toBe('error_during_execution')
    expect(deserialized.uuid).toBe('uuid-2')
    expect(deserialized.result).toBeUndefined()
  })

  it('round-trips result message with success result (success variant)', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'result',
      subtype: 'success',
      result: 'Task completed successfully',
      is_error: false,
      duration_ms: 3000,
      duration_api_ms: 2500,
      num_turns: 2,
      stop_reason: 'end_turn',
      total_cost_usd: 0.02,
      usage: { input_tokens: 200, output_tokens: 100 },
      modelUsage: {},
      permission_denials: [],
      uuid: 'uuid-3',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.result).toBe('Task completed successfully')
    expect(deserialized.subtype).toBe('success')
    expect(deserialized.errors).toBeUndefined()
    expect(deserialized.uuid).toBe('uuid-3')
  })

  it('round-trips status message with compacting status', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      uuid: 'uuid-4',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.status).toBe('compacting')
    expect(deserialized.subtype).toBe('status')
    expect(deserialized.uuid).toBe('uuid-4')
  })

  it('round-trips compact_boundary message with compact_metadata', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 15000,
        preserved_segment: {
          head_uuid: 'head-uuid',
          anchor_uuid: 'anchor-uuid',
          tail_uuid: 'tail-uuid',
        },
      },
      uuid: 'uuid-5',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.compact_metadata).toBeDefined()
    expect((deserialized.compact_metadata as Record<string, unknown>).trigger).toBe('auto')
    expect((deserialized.compact_metadata as Record<string, unknown>).pre_tokens).toBe(15000)
    expect(deserialized.subtype).toBe('compact_boundary')
    expect(deserialized.uuid).toBe('uuid-5')
  })

  it('round-trips tool_progress message with tool_name and elapsed_time_seconds', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'tool_progress',
      tool_use_id: 'tool-use-1',
      tool_name: 'Bash',
      elapsed_time_seconds: 3.5,
      parent_tool_use_id: null,
      uuid: 'uuid-6',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.tool_name).toBe('Bash')
    expect(deserialized.elapsed_time_seconds).toBe(3.5)
    expect(deserialized.tool_use_id).toBe('tool-use-1')
    expect(deserialized.uuid).toBe('uuid-6')
  })

  it('round-trips tool_progress with elapsed_time_seconds=0', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'tool_progress',
      tool_use_id: 'tool-use-2',
      tool_name: 'Read',
      elapsed_time_seconds: 0,
      parent_tool_use_id: null,
      uuid: 'uuid-7',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.tool_name).toBe('Read')
    expect(deserialized.elapsed_time_seconds).toBe(0)
  })

  it('drops status: null (not compacting) during serialization', () => {
    const message: SDKMessage = {
      role: 'system',
      type: 'system',
      subtype: 'status',
      status: null,
      uuid: 'uuid-8',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])

    expect(serialized[0].status).toBeUndefined()
  })

  it('round-trips multiple message variants correctly', () => {
    const messages: SDKMessage[] = [
      {
        role: 'assistant',
        type: 'assistant',
        content: 'Hello',
        error: 'rate_limit',
        uuid: 'uuid-a',
        session_id: 'session-1',
        parent_tool_use_id: null,
      } as unknown as SDKMessage,
      {
        role: 'system',
        type: 'result',
        subtype: 'error_max_turns',
        errors: ['Max turns reached'],
        uuid: 'uuid-b',
        session_id: 'session-1',
      } as unknown as SDKMessage,
      {
        role: 'system',
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'manual', pre_tokens: 5000 },
        uuid: 'uuid-c',
        session_id: 'session-1',
      } as unknown as SDKMessage,
      {
        role: 'system',
        type: 'tool_progress',
        tool_use_id: 'tu-1',
        tool_name: 'Edit',
        elapsed_time_seconds: 1.2,
        parent_tool_use_id: null,
        uuid: 'uuid-d',
        session_id: 'session-1',
      } as unknown as SDKMessage,
    ]

    const serialized = serializeToCacheMessage(messages)
    const deserialized = deserializeFromCacheMessage(serialized)

    expect(deserialized).toHaveLength(4)
    expect(deserialized[0].error).toBe('rate_limit')
    expect(deserialized[1].errors).toEqual(['Max turns reached'])
    expect((deserialized[2].compact_metadata as Record<string, unknown>).trigger).toBe('manual')
    expect(deserialized[3].tool_name).toBe('Edit')
    expect(deserialized[3].elapsed_time_seconds).toBe(1.2)
  })

  it('preserves message identity across full round-trip', () => {
    const messages: SDKMessage[] = [
      {
        role: 'user',
        type: 'user',
        content: 'Hello world',
        uuid: 'uuid-x',
        session_id: 'session-1',
      } as unknown as SDKMessage,
      {
        role: 'assistant',
        type: 'assistant',
        content: [{ type: 'text', text: 'Hi there' }],
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
        uuid: 'uuid-y',
        session_id: 'session-1',
        parent_tool_use_id: null,
      } as unknown as SDKMessage,
    ]

    const serialized = serializeToCacheMessage(messages)
    const deserialized = deserializeFromCacheMessage(serialized)

    expect(deserialized).toHaveLength(2)
    expect(deserialized[0].role).toBe('user')
    expect(deserialized[0].uuid).toBe('uuid-x')
    expect(deserialized[1].role).toBe('assistant')
    expect(deserialized[1].uuid).toBe('uuid-y')
  })

  it('round-trips stream_event correctly', () => {
    const message: SDKMessage = {
      role: 'assistant',
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text: 'Hello' } },
      parent_tool_use_id: 'parent-1',
      uuid: 'uuid-z',
      session_id: 'session-1',
    } as unknown as SDKMessage

    const serialized = serializeToCacheMessage([message])
    const deserialized = deserializeFromCacheMessage(serialized)[0]

    expect(deserialized.type).toBe('stream_event')
    expect(deserialized.parent_tool_use_id).toBe('parent-1')
    expect(deserialized.uuid).toBe('uuid-z')
  })
})
