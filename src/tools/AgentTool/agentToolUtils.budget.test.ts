import { expect, test } from 'bun:test'

import { createAssistantMessage, createAssistantAPIErrorMessage } from '../../utils/messages.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { createAgentExecutionBudgetState } from '../../query/agentExecutionBudget.js'
import { finalizeAgentTool } from './agentToolUtils.js'
import { completeAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { AppState } from '../../state/AppState.js'

test('returns prior findings together with the hard-timeout notice', () => {
  const budget = createAgentExecutionBudgetState(
    {
      maxToolCalls: 40,
      softTimeoutMs: 150_000,
      hardTimeoutMs: 180_000,
      reserveFinalTurn: true,
    },
    Date.now() - 1_000,
  )
  budget.apiCalls = 2
  budget.toolCalls = 3
  budget.completionReason = 'timeout'

  const result = finalizeAgentTool(
    [
      createAssistantMessage({ content: 'Useful partial finding.' }),
      createAssistantMessage({
        content: 'Explore reached its time budget.',
        isVirtual: true,
      }),
    ],
    'agent-test',
    {
      prompt: 'Inspect the repository.',
      resolvedAgentModel: 'gpt-5.6-sol',
      isBuiltInAgent: true,
      startTime: Date.now() - 1_000,
      agentType: 'Explore',
      isAsync: false,
      executionBudgetState: budget,
    },
  )

  expect(result.content.map(block => block.text)).toEqual([
    'Useful partial finding.',
    'Explore reached its time budget.',
  ])
  expect(result.completionReason).toBe('timeout')
  expect(result.budgetUsage).toMatchObject({
    apiCalls: 2,
    toolCalls: 3,
    maxToolCalls: 40,
    hardTimeoutMs: 180_000,
  })
})

test('an API error is a failed task; a later recovered response can complete normally', () => {
  const error = createAssistantAPIErrorMessage({ content: 'Provider request rejected' })
  const metadata = { prompt: 'fixture', resolvedAgentModel: 'fixture', isBuiltInAgent: true, startTime: Date.now(), agentType: 'general-purpose', isAsync: true }
  const failed = finalizeAgentTool([error], 'agent-test', metadata)
  expect(failed.completionReason).toBe('failed')
  expect(failed.tokenUsage?.state).toBe('pending')
  let state = { tasks: { 'agent-test': { id: 'agent-test', type: 'local_agent', status: 'running' } } } as unknown as AppState
  completeAgentTask(failed, update => { state = update(state) })
  expect(state.tasks['agent-test']).toMatchObject({ status: 'failed', error: 'Provider request rejected', result: failed })
  const recovered = finalizeAgentTool([error, createAssistantMessage({ content: 'Recovered result' })], 'agent-test', metadata)
  expect(recovered.completionReason).toBe('completed')
})

test('the max_turns attachment carries the terminal reason without a separate execution budget', () => {
  const result = finalizeAgentTool([
    createAssistantMessage({ content: 'Partial finding' }),
    createAttachmentMessage({ type: 'max_turns_reached', maxTurns: 1 }),
  ], 'agent-test', { prompt: 'fixture', resolvedAgentModel: 'fixture', isBuiltInAgent: true, startTime: Date.now(), agentType: 'general-purpose', isAsync: false })
  expect(result.completionReason).toBe('max_turns')
  expect(result.content[0]?.text).toBe('Partial finding')
})
