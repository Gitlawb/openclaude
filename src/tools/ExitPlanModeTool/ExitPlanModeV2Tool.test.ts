import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  setDynamicTeamContext,
  clearDynamicTeamContext,
} from '../../utils/teammate.js'

type ExitPlanModeModule = typeof import('./ExitPlanModeV2Tool.js')
type ExitPlanModeTool = ExitPlanModeModule['ExitPlanModeV2Tool']

let ExitPlanModeV2Tool: ExitPlanModeTool | undefined
let actualPlans: any
let actualTeammateMailbox: any

beforeAll(async () => {
  await acquireSharedMutationLock(
    'tools/ExitPlanModeTool/ExitPlanModeV2Tool.test.ts',
  )

  actualPlans = await import('../../utils/plans.ts')
  actualTeammateMailbox = await import('../../utils/teammateMailbox.ts')

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

afterAll(async () => {
  try {
    mock.restore()
    clearDynamicTeamContext()
    // Restore mock modules back to their actual implementations
    mock.module('../../utils/plans.js', () => actualPlans)
    mock.module('../../utils/teammateMailbox.js', () => actualTeammateMailbox)
    mock.module('fs/promises', () => require('fs/promises'))
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
  mock.module('../../utils/plans.js', () => ({
    ...actualPlans,
    getPlanFilePath: () => '/tmp/test-plan.md',
    getPlan: () => 'plan content',
    persistFileSnapshotIfRemote: persistFileSnapshotIfRemoteMock,
  }))

  clearDynamicTeamContext()

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
    clearDynamicTeamContext()
    mock.module('../../utils/plans.js', () => actualPlans)
    mock.module('fs/promises', () => require('fs/promises'))
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
  mock.module('../../utils/plans.js', () => ({
    ...actualPlans,
    getPlanFilePath: () => '/tmp/test-plan.md',
    getPlan: () => 'plan content',
    persistFileSnapshotIfRemote: persistFileSnapshotIfRemoteMock,
  }))

  setDynamicTeamContext({
    agentId: 'test-agent',
    agentName: 'test-agent',
    teamName: 'test-team',
    planModeRequired: true,
  })

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
    clearDynamicTeamContext()
    mock.module('../../utils/plans.js', () => actualPlans)
    mock.module('../../utils/teammateMailbox.js', () => actualTeammateMailbox)
    mock.module('fs/promises', () => require('fs/promises'))
  }
})
