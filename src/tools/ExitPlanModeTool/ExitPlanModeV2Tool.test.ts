import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'

type ExitPlanModeModule = typeof import('./ExitPlanModeV2Tool.js')
type ExitPlanModeTool = ExitPlanModeModule['ExitPlanModeV2Tool']

let ExitPlanModeV2Tool: ExitPlanModeTool | undefined

beforeAll(async () => {
  await acquireSharedMutationLock(
    'tools/ExitPlanModeTool/ExitPlanModeV2Tool.test.ts',
  )

  const actualPlans = await import(
    `../../utils/plans.ts?exitPlanModeWriteTest=${Date.now()}-${Math.random()}`
  )

  mock.module('../../utils/plans.js', () => ({
    ...actualPlans,
    getPlanFilePath: () => '/tmp/test-plan.md',
    getPlan: () => 'plan content',
    persistFileSnapshotIfRemote: () => Promise.resolve(),
  }))

  const mod = await import(
    `./ExitPlanModeV2Tool.ts?exitPlanModeWriteTest=${Date.now()}-${Math.random()}`
  )
  ExitPlanModeV2Tool = mod.ExitPlanModeV2Tool
})

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

function makeCtx() {
  const toolPermissionContext = getEmptyToolPermissionContext()
  return {
    abortController: new AbortController(),
    agentId: undefined,
    options: { isNonInteractiveSession: false, tools: [] },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: () => undefined,
    setToolJSX: undefined,
    toolUseId: 'test-exit-plan-mode',
    addNotification: undefined,
  } as never
}

test('surfaces write error when plan file write fails and asserts no side effects (standard)', async () => {
  const simulatedError = new Error('Simulated write failure')
  const writeFileMock = mock(async () => {
    throw simulatedError
  })

  mock.module('fs/promises', () => ({
    writeFile: writeFileMock,
  }))

  const persistFileSnapshotIfRemoteMock = mock(() => Promise.resolve())
  const actualPlans = await import(
    `../../utils/plans.ts?test1=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/plans.js', () => ({
    ...actualPlans,
    getPlanFilePath: () => '/tmp/test-plan.md',
    getPlan: () => 'plan content',
    persistFileSnapshotIfRemote: persistFileSnapshotIfRemoteMock,
  }))

  const actualTeammate = await import(
    `../../utils/teammate.ts?test1=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/teammate.js', () => ({
    ...actualTeammate,
    isTeammate: () => false,
    isPlanModeRequired: () => false,
  }))

  const setAppStateMock = mock(() => undefined)
  const toolPermissionContext = getEmptyToolPermissionContext()
  const ctx = {
    abortController: new AbortController(),
    agentId: undefined,
    options: { isNonInteractiveSession: false, tools: [] },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: setAppStateMock,
    setToolJSX: undefined,
    toolUseId: 'test-exit-plan-mode',
    addNotification: undefined,
  } as never

  const mod = await import(
    `./ExitPlanModeV2Tool.ts?test1=${Date.now()}-${Math.random()}`
  )

  try {
    await expect(
      mod.ExitPlanModeV2Tool.call(
        { plan: 'edited plan content' } as never,
        ctx,
        (() => Promise.resolve({ behavior: 'allow' })) as never,
        {} as never,
      ),
    ).rejects.toThrow(simulatedError)

    expect(writeFileMock).toHaveBeenCalled()
    expect(persistFileSnapshotIfRemoteMock).not.toHaveBeenCalled()
    expect(setAppStateMock).not.toHaveBeenCalled()
  } finally {
    mock.restore()
  }
})

test('surfaces write error when plan file write fails and asserts no teammate approval side effects', async () => {
  const simulatedError = new Error('Simulated write failure')
  const writeFileMock = mock(async () => {
    throw simulatedError
  })

  mock.module('fs/promises', () => ({
    writeFile: writeFileMock,
  }))

  const persistFileSnapshotIfRemoteMock = mock(() => Promise.resolve())
  const actualPlans = await import(
    `../../utils/plans.ts?test2=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/plans.js', () => ({
    ...actualPlans,
    getPlanFilePath: () => '/tmp/test-plan.md',
    getPlan: () => 'plan content',
    persistFileSnapshotIfRemote: persistFileSnapshotIfRemoteMock,
  }))

  const actualTeammate = await import(
    `../../utils/teammate.ts?test2=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/teammate.js', () => ({
    ...actualTeammate,
    isTeammate: () => true,
    isPlanModeRequired: () => true,
    getAgentName: () => 'test-agent',
    getTeamName: () => 'test-team',
  }))

  const writeToMailboxMock = mock(() => Promise.resolve())
  mock.module('../../utils/teammateMailbox.js', () => ({
    writeToMailbox: writeToMailboxMock,
  }))

  const setAppStateMock = mock(() => undefined)
  const toolPermissionContext = getEmptyToolPermissionContext()
  const ctx = {
    abortController: new AbortController(),
    agentId: undefined,
    options: { isNonInteractiveSession: false, tools: [] },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: setAppStateMock,
    setToolJSX: undefined,
    toolUseId: 'test-exit-plan-mode',
    addNotification: undefined,
  } as never

  const mod = await import(
    `./ExitPlanModeV2Tool.ts?test2=${Date.now()}-${Math.random()}`
  )

  try {
    await expect(
      mod.ExitPlanModeV2Tool.call(
        { plan: 'edited plan content' } as never,
        ctx,
        (() => Promise.resolve({ behavior: 'allow' })) as never,
        {} as never,
      ),
    ).rejects.toThrow(simulatedError)

    expect(writeFileMock).toHaveBeenCalled()
    expect(persistFileSnapshotIfRemoteMock).not.toHaveBeenCalled()
    expect(writeToMailboxMock).not.toHaveBeenCalled()
    expect(setAppStateMock).not.toHaveBeenCalled()
  } finally {
    mock.restore()
  }
})
