import { describe, expect, mock, test } from 'bun:test'
import { createHeadlessHeartbeatStructuredEmitter } from './print.js'
import type { HeadlessHeartbeatEvent } from './headlessHeartbeat.js'

const heartbeatEvent: HeadlessHeartbeatEvent = {
  type: 'system',
  subtype: 'heartbeat',
  timestamp: '2026-06-25T12:00:30.000Z',
  elapsed_ms: 30_000,
  since_last_activity_ms: 30_000,
  state: 'running',
  phase: 'in_turn',
  heartbeat_index: 1,
  pending_permission_requests: 0,
  background_tasks: {},
  uuid: 'heartbeat-uuid',
  session_id: 'session-id',
}

describe('createHeadlessHeartbeatStructuredEmitter', () => {
  test('writes heartbeat events immediately before the stream-json drain starts', async () => {
    const write = mock(async (_message: HeadlessHeartbeatEvent) => {})
    const enqueue = mock((_message: HeadlessHeartbeatEvent) => {})
    const emitter = createHeadlessHeartbeatStructuredEmitter(
      { write, outbound: { enqueue } },
      () => false,
    )

    await emitter(heartbeatEvent)

    expect(write).toHaveBeenCalledWith(heartbeatEvent)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('enqueues heartbeat events after the stream-json drain starts', async () => {
    const write = mock(async (_message: HeadlessHeartbeatEvent) => {})
    const enqueue = mock((_message: HeadlessHeartbeatEvent) => {})
    const emitter = createHeadlessHeartbeatStructuredEmitter(
      { write, outbound: { enqueue } },
      () => true,
    )

    await emitter(heartbeatEvent)

    expect(write).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(heartbeatEvent)
  })
})
