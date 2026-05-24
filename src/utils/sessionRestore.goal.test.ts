import { describe, expect, test } from 'bun:test'

import { createGoalState, markGoalEvaluated } from '../services/goal/state.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import {
  processResumedConversation,
  restoreSessionStateFromLog,
} from './sessionRestore.js'

describe('session restore goal lifecycle', () => {
  test('processResumedConversation restores active goal into initial state', async () => {
    const goal = markGoalEvaluated(createGoalState('finish after resume'), {
      evaluatedMessageUuid: 'assistant-1',
      decision: 'incomplete',
      reason: 'more files remain',
    })

    const result = await processResumedConversation(
      {
        messages: [],
        sessionId: '00000000-0000-4000-8000-000000001234',
        goal,
      },
      {
        forkSession: true,
      },
      {
        modeApi: null,
        mainThreadAgentDefinition: undefined,
        agentDefinitions: { activeAgents: [], allAgents: [] },
        currentCwd: '/tmp',
        cliAgents: [],
        initialState: getDefaultAppState(),
      },
    )

    expect(result.initialState.goal?.status).toBe('active')
    expect(result.initialState.goal?.condition).toBe('finish after resume')
    expect(result.initialState.goal?.turnCount).toBe(0)
    expect(result.initialState.goal?.lastEvaluatedMessageUuid).toBeUndefined()
  })

  test('processResumedConversation clears stale goal when resumed session has none', async () => {
    const staleGoal = createGoalState('stale previous session goal')

    const result = await processResumedConversation(
      {
        messages: [],
        sessionId: '00000000-0000-4000-8000-000000001235',
      },
      {
        forkSession: true,
      },
      {
        modeApi: null,
        mainThreadAgentDefinition: undefined,
        agentDefinitions: { activeAgents: [], allAgents: [] },
        currentCwd: '/tmp',
        cliAgents: [],
        initialState: {
          ...getDefaultAppState(),
          goal: staleGoal,
        },
      },
    )

    expect(result.initialState.goal).toBeNull()
  })

  test('restoreSessionStateFromLog clears stale in-memory goal when resumed session has none', () => {
    const staleGoal = createGoalState('stale interactive resume goal')
    let state = {
      ...getDefaultAppState(),
      goal: staleGoal,
    }

    restoreSessionStateFromLog({}, update => {
      state = update(state)
    })

    expect(state.goal).toBeNull()
  })
})
