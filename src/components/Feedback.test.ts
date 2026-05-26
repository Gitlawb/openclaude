import { afterEach, beforeEach, expect, test } from 'bun:test'

import { createGitHubIssueUrl } from './Feedback.tsx'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalMacro = (globalThis as { MACRO?: unknown }).MACRO

beforeEach(async () => {
  await acquireSharedMutationLock('Feedback.test.ts')
  ;(globalThis as { MACRO?: { VERSION?: string } }).MACRO = { VERSION: '0.1.7' }
})

afterEach(() => {
  try {
    if (originalMacro === undefined) {
      delete (globalThis as { MACRO?: unknown }).MACRO
    } else {
      ;(globalThis as { MACRO?: unknown }).MACRO = originalMacro
    }
  } finally {
    releaseSharedMutationLock()
  }
})

test('createGitHubIssueUrl omits empty feedback IDs', () => {
  const url = decodeURIComponent(
    createGitHubIssueUrl('', 'Bug title', 'Bug description', []),
  )

  expect(url).not.toContain('Feedback ID:')
  expect(url).toContain('Bug Description')
  expect(url).toContain('Errors')
})

test('createGitHubIssueUrl includes feedback IDs when present', () => {
  const url = decodeURIComponent(
    createGitHubIssueUrl('fb-123', 'Bug title', 'Bug description', []),
  )

  expect(url).toContain('Feedback ID: fb-123')
})
