import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  achieveGoal,
  createGoalState,
  pauseGoal,
} from '../../services/goal/state.js'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'

type OnDoneArgs = Parameters<LocalJSXCommandOnDone>

let saveGoalStateMock: ReturnType<typeof mock>

async function importFreshResumeModule(): Promise<
  typeof import('./resume.js')
> {
  const unique = `${Date.now()}-${Math.random()}`
  return import(`./resume.js?${unique}`) as Promise<
    typeof import('./resume.js')
  >
}

function makeContext(
  opts: {
    goal?: AppState['goal']
    todos?: AppState['todos']
  } = {},
) {
  let state: AppState = {
    ...getDefaultAppState(),
    goal: opts.goal ?? null,
    todos: opts.todos ?? {},
  }

  return {
    context: {
      getAppState: () => state,
      setAppState: (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      },
      agentId: 'agent-test-123',
    } as unknown as LocalJSXCommandContext,
    getState: () => state,
  }
}

describe('/resume and /continue unified command', () => {
  beforeEach(() => {
    saveGoalStateMock = mock(() => Promise.resolve())
    mock.module('../../services/goal/persistence.js', () => ({
      saveGoalState: saveGoalStateMock,
    }))
    mock.module('../../utils/getWorktreePaths.js', () => ({
      getWorktreePaths: () => Promise.resolve([]),
    }))
    mock.module('../../utils/sessionStorage.js', () => ({
      getLastSessionLog: () => Promise.resolve(null),
      getSessionIdFromLog: (log: { sessionId?: string }) => log.sessionId,
      isCustomTitleEnabled: () => false,
      isLiteLog: () => false,
      loadAllProjectsMessageLogs: () => Promise.resolve([]),
      loadFullLog: (log: unknown) => Promise.resolve(log),
      loadSameRepoMessageLogs: () => Promise.resolve([]),
      searchSessionsByCustomTitle: () => Promise.resolve([]),
    }))
  })

  afterEach(() => {
    mock.restore()
  })

  test('/continue continues an active goal', async () => {
    const activeGoal = {
      ...createGoalState('finish the feature'),
      turnCount: 7,
      lastEvaluatedMessageUuid: 'assistant-1',
    }
    const { context, getState } = makeContext({
      goal: activeGoal,
    })
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, '')

    expect(element).toBeNull()
    expect(onDoneResult).toBeDefined()
    expect(onDoneResult![0]).toBe('Goal already active; continuing.')
    expect(onDoneResult![1]?.shouldQuery).toBe(true)
    expect(onDoneResult![1]?.metaMessages).toHaveLength(1)
    expect(onDoneResult![1]?.metaMessages![0]).toContain('finish the feature')
    expect(getState().goal?.status).toBe('active')
    expect(getState().goal?.turnCount).toBe(7)
    expect(getState().goal?.lastEvaluatedMessageUuid).toBe('assistant-1')
  })

  test('/continue resumes a paused goal and continues it', async () => {
    const { context, getState } = makeContext({
      goal: pauseGoal(createGoalState('finish the feature')),
    })
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, '')

    expect(element).toBeNull()
    expect(onDoneResult![0]).toBe('Goal resumed.')
    expect(onDoneResult![1]?.shouldQuery).toBe(true)
    expect(onDoneResult![1]?.metaMessages![0]).toContain('finish the feature')
    expect(getState().goal?.status).toBe('active')
  })

  test('/continue still resumes a paused goal when persistence fails', async () => {
    saveGoalStateMock.mockImplementation(() =>
      Promise.reject(new Error('disk full')),
    )
    const { context, getState } = makeContext({
      goal: pauseGoal(createGoalState('finish the feature')),
    })
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, '')

    expect(element).toBeNull()
    expect(onDoneResult![0]).toBe('Goal resumed.')
    expect(onDoneResult![1]?.shouldQuery).toBe(true)
    expect(onDoneResult![1]?.metaMessages![0]).toContain('finish the feature')
    expect(getState().goal?.status).toBe('active')
    expect(saveGoalStateMock).toHaveBeenCalled()
  })

  test('falls back to session picker when goal is achieved', async () => {
    const { context } = makeContext({
      goal: achieveGoal(createGoalState('finish the feature'), {
        evaluatedMessageUuid: 'assistant-1',
        reason: 'completed',
      }),
    })
    const { call } = await importFreshResumeModule()

    const onDone = mock(() => {})
    const element = await call(onDone as unknown as LocalJSXCommandOnDone, context, '')

    expect(element).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  test('/continue continues current todos when no goal is set', async () => {
    const { context } = makeContext({
      todos: {
        'agent-test-123': [
          { content: 'write tests', status: 'completed', activeForm: 'write tests' },
          { content: 'run ci', status: 'in_progress', activeForm: 'run ci' },
          { content: 'deploy', status: 'pending', activeForm: 'deploy' },
        ],
      },
    })
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, '')

    expect(element).toBeNull()
    expect(onDoneResult![0]).toBe('Continuing current task.')
    expect(onDoneResult![1]?.shouldQuery).toBe(true)
    const metaMessage = onDoneResult![1]?.metaMessages![0]
    expect(metaMessage).toContain('write tests')
    expect(metaMessage).toContain('run ci')
    expect(metaMessage).toContain('deploy')
    expect(metaMessage).toContain('[done] write tests')
    expect(metaMessage).toContain('[in progress] run ci')
    expect(metaMessage).toContain('[pending] deploy')
    expect(metaMessage).toContain('Resume the most recent task')
  })

  test('falls back to session picker when no goal or todos', async () => {
    const { context } = makeContext()
    const { call } = await importFreshResumeModule()

    const onDone = mock(() => {})
    const element = await call(onDone as unknown as LocalJSXCommandOnDone, context, '')

    expect(element).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  test('/resume still shows picker when current task state exists', async () => {
    const { context } = makeContext({
      goal: createGoalState('finish the feature'),
      todos: {
        'agent-test-123': [
          { content: 'run ci', status: 'in_progress', activeForm: 'run ci' },
        ],
      },
    })
    const { call } = await importFreshResumeModule()

    const onDone = mock(() => {})
    const element = await call(onDone as unknown as LocalJSXCommandOnDone, context, '')

    expect(element).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  test('/continue continues from transcript when no goal or todos are tracked', async () => {
    const { context } = makeContext()
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, '')

    expect(element).toBeNull()
    expect(onDoneResult![0]).toBe('Continuing current task.')
    expect(onDoneResult![1]?.shouldQuery).toBe(true)
    expect(onDoneResult![1]?.metaMessages![0]).toContain(
      'The user asked you to continue.',
    )
    expect(onDoneResult![1]?.metaMessages![0]).toContain(
      'Resume the most recent task based on the conversation transcript.',
    )
  })

  test('/continue includes an optional user continuation hint', async () => {
    const { context } = makeContext()
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, 'pick up at tests')

    expect(element).toBeNull()
    expect(onDoneResult![1]?.metaMessages![0]).toContain(
      'User continuation hint:\npick up at tests',
    )
    expect(onDoneResult![1]?.metaMessages![0]).toContain(
      'The user asked you to continue.',
    )
  })

  test('/continue includes an optional hint with current todos', async () => {
    const { context } = makeContext({
      todos: {
        'agent-test-123': [
          { content: 'run ci', status: 'in_progress', activeForm: 'run ci' },
        ],
      },
    })
    const { continueCall } = await importFreshResumeModule()

    let onDoneResult: OnDoneArgs | undefined
    const onDone = (...args: OnDoneArgs) => {
      onDoneResult = args
    }

    const element = await continueCall(onDone, context, 'focus on the failing tests')

    expect(element).toBeNull()
    expect(onDoneResult![1]?.metaMessages![0]).toContain('[in progress] run ci')
    expect(onDoneResult![1]?.metaMessages![0]).toContain(
      'User continuation hint:\nfocus on the failing tests',
    )
    expect(onDoneResult![1]?.metaMessages![0]).toContain(
      'The user asked you to continue.',
    )
  })

  test('with args bypasses current-task continuation and searches sessions', async () => {
    const { context } = makeContext({
      goal: createGoalState('finish the feature'),
    })
    const { call } = await importFreshResumeModule()

    const onDone = mock(() => {})
    const element = await call(onDone as unknown as LocalJSXCommandOnDone, context, 'feature')

    expect(element).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })
})
