import { expect, test } from 'bun:test'

import { buildResumeTaskOptionLabel } from './resumeTaskLabel.js'

const repo = {
  name: 'openclaude',
  owner: {
    login: 'Gitlawb',
  },
  default_branch: 'main',
} as const

test('buildResumeTaskOptionLabel keeps time alignment and appends repo when available', () => {
  expect(buildResumeTaskOptionLabel('Updated', 'Investigate OAuth callback', repo, 7)).toBe(
    'Updated  Investigate OAuth callback  Gitlawb/openclaude',
  )
  expect(buildResumeTaskOptionLabel('2h ago', 'Untitled', null, 7)).toBe('2h ago   Untitled')
})

test('buildResumeTaskOptionLabel truncates the repository suffix for narrow terminals', () => {
  expect(
    buildResumeTaskOptionLabel('Updated', 'Investigate OAuth callback', repo, 7, 41),
  ).toBe('Updated  Investigate OAuth callback  Git…')
})
