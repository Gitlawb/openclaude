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
    options: { isNonInteractiveSession: false },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: () => undefined,
    setToolJSX: undefined,
    toolUseId: 'test-exit-plan-mode',
    addNotification: undefined,
  } as never
}

test('surfaces write error when plan file write fails', async () => {
  // Re-mock plans.js to point getPlanFilePath at a directory that doesn't
  // exist, so the REAL fs/promises.writeFile rejects with ENOENT. This
  // avoids mocking fs/promises globally, which leaked into
  // loadAgentsDir.test.ts on Linux CI even with afterEach(mock.restore()).
  // The fresh tool import picks up the new mock.
  const actualPlans = await import(
    `../../utils/plans.ts?failCase=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/plans.js', () => ({
    ...actualPlans,
    getPlanFilePath: () =>
      '/nonexistent-dir-for-test/test-plan.md',
    getPlan: () => 'plan content',
    persistFileSnapshotIfRemote: () => Promise.resolve(),
  }))

  const mod = await import(
    `./ExitPlanModeV2Tool.ts?failCase=${Date.now()}-${Math.random()}`
  )
  await expect(
    mod.ExitPlanModeV2Tool.call(
      { plan: 'edited plan content' } as never,
      makeCtx(),
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
    ),
  ).rejects.toThrow()
})
