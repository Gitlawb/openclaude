import { expect, test } from 'bun:test'
import { stringWidth } from '../ink/stringWidth.js'
import { getGraphemeSegmenter } from '../utils/intl.js'

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

test('buildResumeTaskOptionLabel handles emoji titles without breaking surrogates', () => {
  const emojiTitle = '🚀🚀🚀 long title with emoji'
  const result = buildResumeTaskOptionLabel('Updated', emojiTitle, repo, 7, 40)
  expect(stringWidth(result)).toBeLessThanOrEqual(40)
  // Ensure grapheme segmentation works (no broken clusters)
  const segmenter = getGraphemeSegmenter()
  const segments = [...segmenter.segment(result)]
  // Each segment should be a valid grapheme cluster
  for (const { segment } of segments) {
    expect(segment.length).toBeGreaterThan(0)
  }
  // Ensure ellipsis is present when truncated
  expect(result).toContain('…')
})

test('buildResumeTaskOptionLabel clamps when label budget is zero', () => {
  // Terminal width 7 with 1 option: index width = 1 + 2 = 3, rowChrome = 2 + 3 + 2 = 7, budget = 0
  const result = buildResumeTaskOptionLabel('Updated', 'Long title that should be clamped', repo, 7, 0)
  // Shared helper returns '…' for maxWidth <= 1
  expect(stringWidth(result)).toBeLessThanOrEqual(1)
  expect(result).toBe('…')
})

test('buildResumeTaskOptionsFromMetadata with content width accounts for parent padding', () => {
  const sessionMetadata: ResumeTaskSessionMetadata[] = [
    {
      id: 'session-1',
      title: 'A'.repeat(100),
      description: '',
      status: 'idle',
      repo,
      turns: [],
      created_at: '2026-07-23T00:00:00.000Z',
      updated_at: '2026-07-23T00:00:00.000Z',
      timeString: 'Updated',
    },
  ]
  // Simulate 80-column terminal with parent padding={1} on each side
  const terminalColumns = 80
  const contentColumns = terminalColumns - 2
  const options = buildResumeTaskOptionsFromMetadata(sessionMetadata, contentColumns)

  const label = options[0]!.label
  const labelWidth = stringWidth(label)
  const selectChrome = 2 + String(sessionMetadata.length).length + 2 + 2 // pointer + index + spacing

  // labelWidth + selectChrome should not exceed terminalColumns - 2 (padded inner width)
  expect(labelWidth + selectChrome).toBeLessThanOrEqual(terminalColumns - 2)
})
