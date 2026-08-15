import { expect, test } from 'bun:test'
import { stringWidth } from '../ink/stringWidth.js'

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
  const result = buildResumeTaskOptionLabel('Updated', 'Investigate OAuth callback', repo, 7, 41)
  expect(result).toBe('Updated  Investigate OAuth callback  Git…')
  expect(stringWidth(result)).toBeLessThanOrEqual(41)
})

test('getResumeTaskOptionLabelColumns reserves select chrome width', () => {
  const labelColumns = getResumeTaskOptionLabelColumns(41, 10)

  expect(labelColumns).toBe(33)
  const result = buildResumeTaskOptionLabel(
    'Updated',
    'Investigate OAuth callback',
    repo,
    7,
    labelColumns,
  )
  // Base label (34 cols) exceeds labelColumns (33), so it should be truncated
  expect(stringWidth(result)).toBeLessThanOrEqual(labelColumns)
  expect(result).toContain('Updated')
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
  expect(stringWidth(options[0]!.label)).toBeLessThanOrEqual(
    getResumeTaskOptionLabelColumns(41, 1),
  )
})

test('buildResumeTaskOptionLabel never exceeds terminalColumns with long title', () => {
  const longTitle = 'A'.repeat(100)
  const result = buildResumeTaskOptionLabel('Updated', longTitle, repo, 7, 40)
  expect(stringWidth(result)).toBeLessThanOrEqual(40)
})

test('buildResumeTaskOptionLabel never exceeds terminalColumns with no repo', () => {
  const longTitle = 'B'.repeat(100)
  const result = buildResumeTaskOptionLabel('Updated', longTitle, null, 7, 40)
  expect(stringWidth(result)).toBeLessThanOrEqual(40)
})

test('buildResumeTaskOptionLabel preserves repo truncation behavior', () => {
  // When base fits but repo doesn't, repo should be truncated
  const result = buildResumeTaskOptionLabel('2h ago', 'Short', repo, 7, 30)
  expect(stringWidth(result)).toBeLessThanOrEqual(30)
  expect(result).toContain('2h ago')
  expect(result).toContain('Short')
  expect(result).toContain('Git')
})
