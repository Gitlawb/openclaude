import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realAuth from '../utils/auth.js'
import * as realConfig from '../utils/config.js'
import * as realEffort from '../utils/effort.js'

async function importFreshEffortCallout() {
  return import(`./EffortCallout.tsx?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('components/EffortCallout.modelGate.test.ts')
})

afterEach(() => {
  try {
    mock.restore()
    mock.module('../utils/auth.js', () => realAuth)
    mock.module('../utils/config.js', () => realConfig)
    mock.module('../utils/effort.js', () => realEffort)
  } finally {
    releaseSharedMutationLock()
  }
})

test('shouldShowEffortCallout covers the current default Opus (now 4.8) (#1769)', async () => {
  // Drive the non-model gates to a "show" state so the model check is decisive.
  mock.module('../utils/auth.js', () => ({
    ...realAuth,
    isProSubscriber: () => true,
    isMaxSubscriber: () => false,
    isTeamSubscriber: () => false,
  }))
  mock.module('../utils/config.js', () => ({
    ...realConfig,
    getGlobalConfig: () => ({
      numStartups: 5,
      effortCalloutV2Dismissed: false,
      effortCalloutDismissed: false,
    }),
    saveGlobalConfig: () => {},
  }))
  mock.module('../utils/effort.js', () => ({
    ...realEffort,
    getOpusDefaultEffortConfig: () => ({ enabled: true }),
  }))

  const { shouldShowEffortCallout } = await importFreshEffortCallout()

  // The 'opus' alias resolves to the default Opus (claude-opus-4-8). Pre-fix the
  // gate only matched opus-4-6, so the new default would never show the callout.
  expect(shouldShowEffortCallout('opus')).toBe(true)
  expect(shouldShowEffortCallout('claude-opus-4-8')).toBe(true)
})
