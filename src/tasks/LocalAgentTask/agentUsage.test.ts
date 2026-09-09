import { expect, test } from 'bun:test'
import { createProgressTracker, updateProgressFromMessage, getProgressUpdate, updateProgressUsage, updateAgentProgress } from './LocalAgentTask.js'
import { finalizeAgentTool } from '../../tools/AgentTool/agentToolUtils.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { AgentUsageAccumulator } from '../../utils/agentUsage.js'

test('late usage, duplicated tool records and final virtual messages agree across progress and result', () => {
  const message = createAssistantMessage({ content: [{ type: 'tool_use', id: 'tool-one', name: 'Read', input: { file_path: 'fixture' } }] })
  message.message.model = 'fixture'
  const tracker = createProgressTracker()
  updateProgressFromMessage(tracker, message)
  updateProgressFromMessage(tracker, message)
  message.message.usage = { ...message.message.usage, input_tokens: 123, output_tokens: 45 }
  const notice = createAssistantMessage({ content: 'Time budget reached', isVirtual: true })
  updateProgressFromMessage(tracker, notice)
  const result = finalizeAgentTool([message, message, notice], 'fixture', { prompt: 'fixture', resolvedAgentModel: 'fixture', isBuiltInAgent: false, startTime: Date.now(), agentType: 'test', isAsync: true })
  expect(getProgressUpdate(tracker)).toMatchObject({ tokenCount: 168, toolUseCount: 1 })
  expect(result.totalTokens).toBe(168)
  expect(result.usage.input_tokens).toBe(123)
  expect(result.totalToolUseCount).toBe(1)
})

test('cancel flush keeps consumption without resurrecting a stopped or replaced task', () => {
  let state = { tasks: { agent: { id: 'agent', type: 'local_agent', status: 'killed', executionId: 'current' } } } as any
  const setState = (update: (value: typeof state) => typeof state) => { state = update(state) }
  const progress = { tokenCount: 144, toolUseCount: 1, recentActivities: [] }
  const before = state
  updateAgentProgress('agent', progress, setState, 'old', true)
  expect(state.tasks.agent.progress).toBeUndefined()
  updateAgentProgress('agent', progress, setState, 'current')
  expect(state.tasks.agent.progress).toBeUndefined()
  updateAgentProgress('agent', progress, setState, 'current', true)
  expect(state.tasks.agent.progress.tokenCount).toBe(144)
  expect(state.tasks.agent.status).toBe('killed')
  expect(before.tasks.agent.progress).toBeUndefined()
})

test('foreground/background snapshots are replaced per execution, never added twice', () => {
  const tracker = createProgressTracker()
  const a = new AgentUsageAccumulator()
  const m = createAssistantMessage({ content: 'Result' })
  m.message.model = 'fixture'; m.message.usage.input_tokens = 100
  a.observe(m)
  updateProgressUsage(tracker, { executionId: 'foreground', usage: a.snapshot() })
  updateProgressUsage(tracker, { executionId: 'foreground', usage: a.snapshot() })
  updateProgressUsage(tracker, { executionId: 'background', usage: a.snapshot() })
  expect(getProgressUpdate(tracker).tokenCount).toBe(200)
})
