import { expect, test } from 'bun:test'

import {
  buildResumeTaskOptionLabel,
  getResumeTaskOptionLabelColumns,
} from './resumeTaskLabel.js'

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

test('getResumeTaskOptionLabelColumns reserves select chrome width', () => {
  const labelColumns = getResumeTaskOptionLabelColumns(41, 10)

  expect(labelColumns).toBe(33)
  expect(
    buildResumeTaskOptionLabel(
      'Updated',
      'Investigate OAuth callback',
      repo,
      7,
      labelColumns,
    ),
  ).toBe('Updated  Investigate OAuth callback')
})
