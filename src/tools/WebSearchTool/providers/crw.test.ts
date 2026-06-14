import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'

import { crwProvider } from './crw.ts'

const originalEnv = {
  CRW_API_KEY: process.env.CRW_API_KEY,
  CRW_API_URL: process.env.CRW_API_URL,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('WebSearchTool/providers/crw.test.ts')
})

afterEach(() => {
  try {
    restoreEnv('CRW_API_KEY', originalEnv.CRW_API_KEY)
    restoreEnv('CRW_API_URL', originalEnv.CRW_API_URL)
  } finally {
    releaseSharedMutationLock()
  }
})

describe('crwProvider isConfigured', () => {
  test('true when CRW_API_KEY is set only', () => {
    process.env.CRW_API_KEY = 'crw-test-key'
    delete process.env.CRW_API_URL
    expect(crwProvider.isConfigured()).toBe(true)
  })

  test('true when CRW_API_URL is set only', () => {
    delete process.env.CRW_API_KEY
    process.env.CRW_API_URL = 'http://localhost:3000'
    expect(crwProvider.isConfigured()).toBe(true)
  })

  test('true when both CRW_API_KEY and CRW_API_URL are set', () => {
    process.env.CRW_API_KEY = 'crw-test-key'
    process.env.CRW_API_URL = 'http://localhost:3000'
    expect(crwProvider.isConfigured()).toBe(true)
  })

  test('false when neither CRW_API_KEY nor CRW_API_URL is set', () => {
    delete process.env.CRW_API_KEY
    delete process.env.CRW_API_URL
    expect(crwProvider.isConfigured()).toBe(false)
  })
})
