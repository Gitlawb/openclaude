import { expect, test } from 'bun:test'

import { createGitHubIssueUrl } from './Feedback.tsx'

(globalThis as { MACRO?: { VERSION?: string } }).MACRO = { VERSION: '0.2.0' }

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
