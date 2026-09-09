import { expect, test } from 'bun:test'
import { getIsInteractive, setIsInteractive } from '../bootstrap/state.js'
import { emptyAgentUsage } from './agentUsage.js'
import { parseAgentUsageMetadata } from './agentUsageSchema.js'
import { drainSdkEvents, enqueueSdkEvent, subscribeSdkEvents } from './sdkEventQueue.js'
import { SDKTaskProgressMessageSchema } from '../entrypoints/sdk/coreSchemas.js'

test('20 agents and 10,000 queued progress updates preserve start, final usage and completion events', () => {
  const interactive = getIsInteractive()
  setIsInteractive(false)
  drainSdkEvents()
  try {
    for (let id = 0; id < 20; id++) enqueueSdkEvent({ type: 'system', subtype: 'task_started', task_id: String(id), description: 'fixture' })
    for (let event = 0; event < 10_000; event++) enqueueSdkEvent({ type: 'system', subtype: 'task_progress', task_id: String(event % 20), description: 'fixture', usage: { total_tokens: event, tool_uses: 1, duration_ms: event, token_usage: { ...emptyAgentUsage(), state: 'estimated', estimated: event } } })
    for (let id = 0; id < 20; id++) enqueueSdkEvent({ type: 'system', subtype: 'task_notification', task_id: String(id), status: 'completed', output_file: '', summary: 'done', usage: { total_tokens: 9990, tool_uses: 1, duration_ms: 10_000 } })
    const events = drainSdkEvents()
    expect(events).toHaveLength(60)
    expect(events.filter(event => event.subtype === 'task_started')).toHaveLength(20)
    for (const event of events.filter(event => event.subtype === 'task_progress')) {
      expect(event.usage.total_tokens).toBeGreaterThanOrEqual(9980)
      expect(SDKTaskProgressMessageSchema().parse(event).usage.token_usage?.state).toBe('estimated')
    }
    expect(events.filter(event => event.subtype === 'task_notification')).toHaveLength(20)
    expect(drainSdkEvents()).toEqual([])
  } finally { drainSdkEvents(); setIsInteractive(interactive) }
})

test('usage metadata remains optional and malformed notification metadata is ignored', () => {
  expect(parseAgentUsageMetadata(undefined)).toBeUndefined()
  expect(parseAgentUsageMetadata('{bad')).toBeUndefined()
  expect(parseAgentUsageMetadata('{"confirmed":-3}')).toBeUndefined()
  expect(parseAgentUsageMetadata(JSON.stringify(emptyAgentUsage()))).toEqual(emptyAgentUsage())
})

test('headless subscribers receive progress before the parent yields, and detach cleanly', () => {
  const interactive = getIsInteractive()
  setIsInteractive(false)
  drainSdkEvents()
  const received: string[] = []
  const unsubscribe = subscribeSdkEvents(() => {
    received.push(...drainSdkEvents().map(event => event.subtype))
  })
  try {
    enqueueSdkEvent({ type: 'system', subtype: 'task_started', task_id: 'live', description: 'fixture' })
    enqueueSdkEvent({ type: 'system', subtype: 'task_progress', task_id: 'live', description: 'fixture', usage: { total_tokens: 0, tool_uses: 0, duration_ms: 100, token_usage: { ...emptyAgentUsage(), state: 'estimated', estimated: 42 } } })
    expect(received).toEqual(['task_started', 'task_progress'])
    unsubscribe()
    enqueueSdkEvent({ type: 'system', subtype: 'task_notification', task_id: 'live', status: 'completed', output_file: '', summary: 'done' })
    expect(received).toHaveLength(2)
    expect(drainSdkEvents()).toHaveLength(1)
  } finally { unsubscribe(); drainSdkEvents(); setIsInteractive(interactive) }
})
