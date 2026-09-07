import { expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { runAsyncAgentLifecycle } from './agentToolUtils.js'
import { unregisterAgentForeground } from '../../tasks/LocalAgentTask/LocalAgentTask.js'

test('late output from a previous agent execution cannot update or finish its replacement', async () => {
  let state = { tasks: { agent: { id: 'agent', type: 'local_agent', status: 'running', executionId: 'old' } } } as unknown as AppState
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let worktreeCalls = 0
  const running = runAsyncAgentLifecycle({
    taskId: 'agent', abortController: new AbortController(),
    makeStream: async function* () { await pending; yield createAssistantMessage({ content: 'old result' }) },
    metadata: { prompt: 'test', resolvedAgentModel: 'test', isBuiltInAgent: false,
      startTime: Date.now(), agentType: 'test', isAsync: true },
    description: 'test', toolUseContext: { options: { tools: [] }, getAppState: () => state } as unknown as ToolUseContext,
    rootSetAppState: update => { state = update(state) }, agentIdForCleanup: 'agent', enableSummarization: false,
    getWorktreeResult: async () => { worktreeCalls++; return {} },
  })
  state = { ...state, tasks: { agent: { ...state.tasks.agent!, executionId: 'new' } } } as AppState
  const replacement = state
  release()
  await running
  expect(state).toBe(replacement)
  expect(worktreeCalls).toBe(0)
})

test('a cancelled foreground agent cannot unregister a newer execution of the same agent', () => {
  let cleanups = 0
  let state = { tasks: { agent: { id: 'agent', type: 'local_agent', status: 'running',
    executionId: 'new', isBackgrounded: false, unregisterCleanup: () => { cleanups++ } } } } as unknown as AppState
  const replacement = state
  const setState = (update: (state: AppState) => AppState) => { state = update(state) }
  unregisterAgentForeground('agent', setState, 'old')
  expect(state).toBe(replacement)
  expect(cleanups).toBe(0)
  unregisterAgentForeground('agent', setState, 'new')
  expect(state.tasks.agent).toBeUndefined()
  expect(cleanups).toBe(1)
})
