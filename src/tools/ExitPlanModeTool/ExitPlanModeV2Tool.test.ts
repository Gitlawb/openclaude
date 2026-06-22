import { afterAll, afterEach, beforeAll, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'

type ExitPlanModeModule = typeof import('./ExitPlanModeV2Tool.js')
type ExitPlanModeTool = ExitPlanModeModule['ExitPlanModeV2Tool']

let ExitPlanModeV2Tool: ExitPlanModeTool | undefined
let realWriteFile: typeof import('fs/promises')['writeFile'] | undefined

beforeAll(async () => {
  await acquireSharedMutationLock(
    'tools/ExitPlanModeTool/ExitPlanModeV2Tool.test.ts',
  )

  const actualPlans = await import(
    `../../utils/plans.ts?exitPlanModeWriteTest=${Date.now()}-${Math.random()}`
  )
  const realFs = await import('fs/promises')
  realWriteFile = realFs.writeFile

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

// Restore fs/promises mock after each test so it cannot leak into
// loadAgentsDir.test.ts on Linux CI. Addresses jatmn's P2 on #1725.
afterEach(() => {
  mock.restore()
  // Re-apply the plans mock that afterAll's mock.restore() cleared,
  // so subsequent tests in this file still see the mocked plans module.
  if (realWriteFile) {
    // No-op: plans mock is re-established per test below if needed.
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
  // Mock fs/promises.writeFile to throw. The afterEach restores this so
  // it cannot leak into loadAgentsDir.test.ts on Linux CI.
  const realFs = await import('fs/promises')
  mock.module('fs/promises', () => ({
    ...realFs,
    writeFile: async () => {
      throw Object.assign(new Error('write failed'), { code: 'ENOSPC' })
    },
  }))

  await expect(
    ExitPlanModeV2Tool!.call(
      { plan: 'edited plan content' } as never,
      makeCtx(),
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
    ),
  ).rejects.toThrow('write failed')
})
