import { afterEach, beforeEach, expect, test } from 'bun:test'
import { isAntEmployee } from './buildConfig.ts'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

// Finding #42-2: process.env.USER_TYPE === 'ant' is checked directly in multiple
// places, allowing any external user to activate Anthropic-internal code paths.
// In OpenClaude, this must always be false regardless of env var.

let originalUserType: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('utils/buildConfig.test.ts')
  originalUserType = process.env.USER_TYPE
})

afterEach(() => {
  try {
    if (originalUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = originalUserType
    }
  } finally {
    releaseSharedMutationLock()
  }
})

test('isAntEmployee always returns false in OpenClaude regardless of USER_TYPE env var', () => {
  process.env.USER_TYPE = 'ant'
  expect(isAntEmployee()).toBe(false)
})

test('isAntEmployee returns false even when USER_TYPE is unset', () => {
  delete process.env.USER_TYPE
  expect(isAntEmployee()).toBe(false)
})
