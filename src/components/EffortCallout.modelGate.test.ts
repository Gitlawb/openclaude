import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realAuth from '../utils/auth.js'
import * as realConfig from '../utils/config.js'
import * as realEffort from '../utils/effort.js'
// Import the consumer statically. mock.module() patches the dependency modules
// through live bindings, so the already-evaluated EffortCallout picks up the
// mocks at call time. Relying on a `?ts=` cache-busting dynamic import to force
// a fresh evaluation is not portable — Bun does not re-evaluate the query-tagged
// specifier on Linux CI, so the gate ran against unmocked deps there (#1769).
import { shouldShowEffortCallout } from './EffortCallout.js'

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

test('shouldShowEffortCallout covers the current default Opus (now 4.8) (#1769)', () => {
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

  // The 'opus' alias resolves to the default Opus (claude-opus-4-8). Pre-fix the
  // gate only matched opus-4-6, so the new default would never show the callout.
  expect(shouldShowEffortCallout('opus')).toBe(true)
  expect(shouldShowEffortCallout('claude-opus-4-8')).toBe(true)
})
