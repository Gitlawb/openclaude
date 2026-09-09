import { describe, expect, test } from 'bun:test'
import { AgentUsageAccumulator, agentUsageDisplay, agentUsageFromMessages, combineAgentUsage, createUsagePublisher, type AgentUsageUpdate } from './agentUsage.js'

const stream = (event: Record<string, unknown>) => ({ type: 'stream_event', event })
const start = (id = 'response', usageReported = false) => stream({ type: 'message_start', message: { id, usageReported, usage: { input_tokens: 0, output_tokens: 0 } } })
const delta = (text: string, type = 'text_delta') => stream({ type: 'content_block_delta', delta: { type, [type === 'text_delta' ? 'text' : type === 'thinking_delta' ? 'thinking' : 'partial_json']: text } })
const usage = (input = 123, output = 45) => stream({ type: 'message_delta', usage: { input_tokens: input, output_tokens: output } })
const assistant = (id: string, input: number, output: number, extra = {}) => ({ type: 'assistant', uuid: id, message: { id, model: 'fixture', content: [{ type: 'text', text: 'Result' }], usage: { input_tokens: input, output_tokens: output } }, ...extra })

test('late official usage replaces the estimate, including an explicit zero', () => {
  const a = new AgentUsageAccumulator(20)
  a.observe(start())
  expect(agentUsageDisplay(a.snapshot())).toBe('Awaiting response')
  a.observe(delta('a'.repeat(40)))
  expect(a.snapshot()).toMatchObject({ confirmed: 0, estimated: 30, state: 'estimated' })
  a.observe(usage())
  expect(a.snapshot()).toMatchObject({ confirmed: 168, estimated: 0, state: 'reported' })
  a.observe(usage())
  expect(a.snapshot().confirmed).toBe(168)
  const zero = new AgentUsageAccumulator()
  zero.observe(start()); zero.observe(delta('test')); zero.observe(usage(0, 0))
  expect(agentUsageDisplay(zero.snapshot())).toBe('0 tokens')
})

test('native input usage and cache remain separate from estimated output', () => {
  const a = new AgentUsageAccumulator()
  a.observe(stream({ type: 'message_start', message: { id: 'native', usage: { input_tokens: 10, cache_read_input_tokens: 70, cache_creation_input_tokens: 20, output_tokens: 0 } } }))
  a.observe(delta('hello world!'))
  expect(a.snapshot()).toMatchObject({ confirmed: 100, estimated: 3 })
  a.observe(stream({ type: 'message_delta', usage: { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 7 } }))
  expect(a.snapshot()).toMatchObject({ confirmed: 107, estimated: 0, state: 'reported' })
})

test('missing usage stays approximate after stop and abort; synthetic notices preserve consumption', () => {
  const a = new AgentUsageAccumulator()
  a.observe(start())
  a.observe(delta('thinking and working', 'thinking_delta'))
  a.observe(delta('{"path":"src"}', 'input_json_delta'))
  a.observe(stream({ type: 'message_stop' }))
  a.observe(assistant('notice', 0, 0, { isVirtual: true }))
  expect(a.snapshot().state).toBe('estimated')
  expect(a.snapshot().estimated).toBeGreaterThan(0)
})

test('consumption sums unique responses across retries, including reused provider IDs', () => {
  const a = new AgentUsageAccumulator()
  for (let i = 0; i < 3; i++) { a.observe({ type: 'stream_request_start' }); a.observe(start()); a.observe(usage(10, 5)) }
  expect(a.snapshot().confirmed).toBe(45)
})

test('split and replayed assistant records count response usage once', () => {
  const first = assistant('one', 123, 45)
  const split = { ...first, uuid: 'split' }
  expect(agentUsageFromMessages([first, split, first, assistant('two', 10, 2), assistant('notice', 0, 0, { isVirtual: true })]).confirmed).toBe(180)
})

test('non-streaming fallback preserves an unfinished streaming estimate separately', () => {
  const a = new AgentUsageAccumulator()
  a.observe(start('stream'))
  a.observe(delta('a'.repeat(40)))
  a.observe(assistant('fallback', 10, 3))
  expect(a.snapshot()).toMatchObject({ confirmed: 13, estimated: 10, state: 'estimated' })
})

test('partial and invalid usage cannot turn missing counters into an official zero', () => {
  const a = new AgentUsageAccumulator(100)
  a.observe(start()); a.observe(delta('a'.repeat(40)))
  a.observe(stream({ type: 'message_delta', usage: { input_tokens: 120, output_tokens: 0 }, usageOutputReported: false }))
  expect(a.snapshot()).toMatchObject({ confirmed: 120, estimated: 10, state: 'estimated' })
  a.observe(stream({ type: 'message_delta', usage: { output_tokens: -1, input_tokens: NaN } }))
  expect(a.snapshot()).toMatchObject({ confirmed: 120, estimated: 10, state: 'estimated' })
  a.observe(stream({ type: 'message_delta', usage: { output_tokens: 24 } }))
  expect(a.snapshot()).toMatchObject({ confirmed: 144, estimated: 0, state: 'reported' })
})

describe('seeded concurrent agent event replay', () => {
  for (const count of [1, 2, 8, 20]) test(`${count} agents retain attribution through 10,000 interleaved events`, () => {
    const agents = Array.from({ length: count }, () => new AgentUsageAccumulator())
    for (const a of agents) a.observe(start())
    let seed = 42
    for (let i = 0; i < 10_000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      agents[seed % count]!.observe(delta('chunk'))
    }
    for (const [i, a] of agents.entries()) a.observe(usage(100 + i, 20 + i))
    expect(combineAgentUsage(agents.map(a => a.snapshot())).confirmed).toBe(count * 120 + count * (count - 1))
    for (const [i, a] of agents.entries()) expect(a.snapshot().confirmed).toBe(120 + 2 * i)
  })
})

test('publisher flushes quiet tails and final usage immediately without delayed repaint', async () => {
  const updates: AgentUsageUpdate[] = []
  const publisher = createUsagePublisher(u => updates.push(u))
  const a = new AgentUsageAccumulator()
  a.observe(start()); a.observe(delta('test'))
  for (let i = 0; i < 50; i++) publisher.update({ executionId: 'run', usage: a.snapshot() })
  expect(updates).toHaveLength(0)
  await Bun.sleep(125)
  expect(updates).toHaveLength(1)
  a.observe(usage())
  publisher.update({ executionId: 'run', usage: a.snapshot() }, true)
  expect(updates.at(-1)?.usage.confirmed).toBe(168)
  publisher.flush()
  expect(updates).toHaveLength(2)
})
