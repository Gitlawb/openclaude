import { expect, test } from 'bun:test'

import {
  buildResumeTaskOptionsFromMetadata,
  buildResumeTaskOptionLabel,
  getResumeTaskOptionLabelColumns,
  type ResumeTaskSessionMetadata,
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

test('buildResumeTaskOptionsFromMetadata passes repo and reserved width through mapping', () => {
  const sessionMetadata: ResumeTaskSessionMetadata[] = [
    {
      id: 'session-1',
      title: 'Fix bug',
      description: '',
      status: 'idle',
      repo,
      turns: [],
      created_at: '2026-07-23T00:00:00.000Z',
      updated_at: '2026-07-23T00:00:00.000Z',
      timeString: 'Updated',
    },
  ]

  const options = buildResumeTaskOptionsFromMetadata(sessionMetadata, 41)

  expect(options).toEqual([
    {
      value: 'session-1',
      label: buildResumeTaskOptionLabel(
        'Updated',
        'Fix bug',
        repo,
        7,
        getResumeTaskOptionLabelColumns(41, 1),
      ),
    },
  ])
  expect(options[0]?.label).toContain('Git')
  expect(options[0]?.label).not.toContain('Gitlawb/openclaude')
})
