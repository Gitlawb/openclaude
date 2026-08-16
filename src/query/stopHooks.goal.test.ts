import { describe, expect, test } from 'bun:test'

import { getDefaultAppState, type AppState } from '../state/AppStateStore.js'
import { createGoalState } from '../services/goal/state.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { INTERRUPT_MESSAGE } from '../utils/messages.js'
import { handleStopHooks } from './stopHooks.js'
import type { GoalEvaluationDeps } from '../services/goal/controller.js'

function assistant(uuid: string, text: string) {
  return {
    type: 'assistant',
    uuid,
    message: {
      id: uuid,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [{ type: 'text', text }],
    },
  }
}

function makeToolUseContext(appStateRef: { current: AppState }) {
  return {
    options: {
      isNonInteractiveSession: true,
    },
    abortController: new AbortController(),
    getAppState: () => appStateRef.current,
    setAppState: (updater: (prev: AppState) => AppState) => {
      appStateRef.current = updater(appStateRef.current)
    },
  } as any
}

async function drain(
  generator: AsyncGenerator<any, any>,
): Promise<{ yielded: any[]; returned: any }> {
  const yielded: any[] = []
  while (true) {
    const next = await generator.next()
    if (next.done) return { yielded, returned: next.value }
    yielded.push(next.value)
  }
}

describe('goal continuation stop-hook precedence', () => {
  test('configured Stop hook blocking wins before goal evaluation', async () => {
    const appStateRef = {
      current: {
        ...getDefaultAppState(),
        goal: createGoalState('finish implementation'),
      },
    }
    let goalCalls = 0
    const goalEvaluationDeps: GoalEvaluationDeps = {
      evaluateGoal: async () => {
        goalCalls++
        throw new Error('goal evaluator should not run')
      },
      saveGoalState: async () => {},
    }

    const { returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        makeToolUseContext(appStateRef),
        'sdk',
        false,
        goalEvaluationDeps,
        {
          executeStopHooks: async function* () {
            yield { blockingError: { blockingError: 'blocked' } } as any
          },
          getStopHookMessage: () => 'stop hook blocked',
          isTeammate: () => false,
        },
      ),
    )

    expect(goalCalls).toBe(0)
    expect(returned.preventContinuation).toBe(false)
    expect(returned.stopHookActive).toBe(true)
    expect(returned.blockingErrors).toHaveLength(1)
    expect(returned.blockingErrors[0].message.content).toBe(
      'stop hook blocked',
    )
  })

  test('configured Stop hook preventContinuation wins before goal evaluation', async () => {
    const appStateRef = {
      current: {
        ...getDefaultAppState(),
        goal: createGoalState('finish implementation'),
      },
    }
    let goalCalls = 0
    const goalEvaluationDeps: GoalEvaluationDeps = {
      evaluateGoal: async () => {
        goalCalls++
        throw new Error('goal evaluator should not run')
      },
      saveGoalState: async () => {},
    }

    const { returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        makeToolUseContext(appStateRef),
        'sdk',
        false,
        goalEvaluationDeps,
        {
          executeStopHooks: async function* () {
            yield {
              preventContinuation: true,
              stopReason: 'hook stopped continuation',
            } as any
          },
          isTeammate: () => false,
        },
      ),
    )

    expect(goalCalls).toBe(0)
    expect(returned).toEqual({
      blockingErrors: [],
      preventContinuation: true,
      stopHookActive: false,
    })
  })

  test('goal continuation is not marked as active Stop-hook recursion', async () => {
    const appStateRef = {
      current: {
        ...getDefaultAppState(),
        goal: createGoalState('finish implementation'),
      },
    }
    const goalEvaluationDeps: GoalEvaluationDeps = {
      evaluateGoal: async () => ({
        complete: false,
        confidence: 0.7,
        decision: 'incomplete',
        reason: 'Tests have not been run.',
        nextInstruction: 'Run tests.',
      }),
      saveGoalState: async () => {},
    }

    const { returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        makeToolUseContext(appStateRef),
        'sdk',
        false,
        goalEvaluationDeps,
        {
          executeStopHooks: async function* () {},
          isTeammate: () => false,
        },
      ),
    )

    expect(returned.preventContinuation).toBe(false)
    expect(returned.blockingErrors).toHaveLength(1)
    expect(returned.stopHookActive).toBe(false)
  })

  test('goal continuation user message is yielded for transcript persistence', async () => {
    const appStateRef = {
      current: {
        ...getDefaultAppState(),
        goal: createGoalState('finish implementation'),
      },
    }
    const goalEvaluationDeps: GoalEvaluationDeps = {
      evaluateGoal: async () => ({
        complete: false,
        confidence: 0.7,
        decision: 'incomplete',
        reason: 'Tests have not been run.',
        nextInstruction: 'Run tests.',
      }),
      saveGoalState: async () => {},
    }

    const { yielded, returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        makeToolUseContext(appStateRef),
        'sdk',
        false,
        goalEvaluationDeps,
        {
          executeStopHooks: async function* () {},
          isTeammate: () => false,
        },
      ),
    )

    const yieldedUserMessages = yielded.filter(
      message => message.type === 'user',
    )
    expect(returned.blockingErrors).toHaveLength(1)
    expect(yieldedUserMessages).toHaveLength(1)
    expect(yieldedUserMessages[0]).toBe(returned.blockingErrors[0])
    expect(yieldedUserMessages[0].message.content).toContain('Run tests.')
  })
})

function interruptionMessages(yielded: any[]) {
  return yielded.filter(
    message =>
      message.type === 'user' &&
      Array.isArray(message.message.content) &&
      message.message.content.some(
        (part: any) => part.type === 'text' && part.text === INTERRUPT_MESSAGE,
      ),
  )
}

function systemMessages(yielded: any[]) {
  return yielded.filter(message => message.type === 'system')
}

describe('handleStopHooks abort-reason handling', () => {
  test('abort reason "interrupt" suppresses the synthetic interruption message', async () => {
    const appStateRef = { current: getDefaultAppState() }
    const toolUseContext = makeToolUseContext(appStateRef)

    const { yielded, returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        toolUseContext,
        'sdk',
        false,
        undefined,
        {
          // Abort while the Stop-hook generator is being consumed so the
          // abort branch in handleStopHooks runs with reason 'interrupt'.
          executeStopHooks: async function* () {
            toolUseContext.abortController.abort('interrupt')
            yield {} as any
          },
          isTeammate: () => false,
        },
      ),
    )

    expect(interruptionMessages(yielded)).toHaveLength(0)
    expect(returned.preventContinuation).toBe(true)
  })

  test('query timeout abort yields timeout wording without user interruption', async () => {
    const appStateRef = { current: getDefaultAppState() }
    const toolUseContext = makeToolUseContext(appStateRef)

    const { yielded, returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        toolUseContext,
        'sdk',
        false,
        undefined,
        {
          executeStopHooks: async function* () {
            toolUseContext.abortController.abort('query-timeout')
            yield {} as any
          },
          isTeammate: () => false,
        },
      ),
    )

    expect(interruptionMessages(yielded)).toHaveLength(0)
    expect(systemMessages(yielded)).toMatchObject([
      {
        content: 'Query timed out before completion.',
        level: 'warning',
      },
    ])
    expect(returned.preventContinuation).toBe(true)
  })

  test('background abort yields background wording without user interruption', async () => {
    const appStateRef = { current: getDefaultAppState() }
    const toolUseContext = makeToolUseContext(appStateRef)

    const { yielded, returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        toolUseContext,
        'sdk',
        false,
        undefined,
        {
          executeStopHooks: async function* () {
            toolUseContext.abortController.abort('background')
            yield {} as any
          },
          isTeammate: () => false,
        },
      ),
    )

    expect(interruptionMessages(yielded)).toHaveLength(0)
    expect(systemMessages(yielded)).toMatchObject([
      {
        content: 'Query was backgrounded before completion.',
        level: 'warning',
      },
    ])
    expect(returned.preventContinuation).toBe(true)
  })

  test('default abort still yields the synthetic interruption message', async () => {
    const appStateRef = { current: getDefaultAppState() }
    const toolUseContext = makeToolUseContext(appStateRef)

    const { yielded, returned } = await drain(
      handleStopHooks(
        [],
        [assistant('assistant-1', 'Done.') as any],
        asSystemPrompt([]),
        {},
        {},
        toolUseContext,
        'sdk',
        false,
        undefined,
        {
          // Default abort (user cancel) must still emit the interruption.
          executeStopHooks: async function* () {
            toolUseContext.abortController.abort()
            yield {} as any
          },
          isTeammate: () => false,
        },
      ),
    )

    expect(interruptionMessages(yielded)).toHaveLength(1)
    expect(returned.preventContinuation).toBe(true)
  })
})
