import { expect, test } from 'bun:test'
import type { UUID } from 'node:crypto'

import type { LogOption, SessionBranchEntry } from '../types/logs.js'
import {
  getResumeLogDisplayTitle,
  groupLogsByResumeBranch,
  logMatchesResumePickerSearch,
  shouldLoadMoreResumeLogs,
} from './LogSelector.js'

const ts = '2026-06-30T00:00:00.000Z'

function id(n: number): UUID {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as UUID
}

function branchMeta(
  sessionId: UUID,
  parentSessionId: UUID,
  rootSessionId: UUID,
  branchName: string,
): SessionBranchEntry {
  return {
    type: 'session-branch',
    sessionId,
    parentSessionId,
    rootSessionId,
    branchedFromSessionId: parentSessionId,
    branchName,
    branchedAt: ts,
  }
}

function log(
  sessionId: UUID,
  title: string,
  modifiedOffset: number,
  options: Partial<LogOption> = {},
): LogOption {
  const modified = new Date(Date.parse(ts) + modifiedOffset)
  return {
    date: modified.toISOString(),
    messages: [],
    fullPath: `/tmp/${sessionId}.jsonl`,
    value: modifiedOffset,
    created: new Date(ts),
    modified,
    firstPrompt: title,
    messageCount: 1,
    isSidechain: false,
    sessionId,
    ...options,
  }
}

test('groups root sessions with their branches without moving the group behind newer branches', () => {
  const rootId = id(1)
  const branchAId = id(2)
  const branchBId = id(3)
  const soloId = id(4)
  const root = log(rootId, 'Root planning session', 10, {
    customTitle: 'Root planning session',
  })
  const branchA = log(branchAId, 'Copied root prompt', 40, {
    sessionBranch: branchMeta(branchAId, rootId, rootId, 'Branch A'),
  })
  const branchB = log(branchBId, 'Copied root prompt', 100, {
    sessionBranch: branchMeta(branchBId, rootId, rootId, 'Branch B'),
  })
  const solo = log(soloId, 'Unrelated session', 80, {
    customTitle: 'Unrelated session',
  })

  const groups = groupLogsByResumeBranch([branchB, solo, root, branchA])

  expect(groups.map(group => group.headerLog.sessionId)).toEqual([
    rootId,
    soloId,
  ])
  expect(groups[0]?.childLogs.map(child => child.sessionId)).toEqual([
    branchBId,
    branchAId,
  ])
  expect(groups[0]?.firstIndex).toBe(0)
  expect(groups[1]?.childLogs).toEqual([])
})

test('shows branches with missing parents as standalone sessions', () => {
  const missingRootId = id(20)
  const missingParentId = id(21)
  const branchId = id(22)
  const branch = log(branchId, 'Copied missing parent prompt', 10, {
    sessionBranch: branchMeta(
      branchId,
      missingParentId,
      missingRootId,
      'Detached branch',
    ),
  })

  const groups = groupLogsByResumeBranch([branch])

  expect(groups).toHaveLength(1)
  expect(groups[0]?.headerLog.sessionId).toBe(branchId)
  expect(groups[0]?.childLogs).toEqual([])
})

test('search and display include branch names and session titles', () => {
  const rootId = id(30)
  const branchId = id(31)
  const root = log(rootId, 'Investigate OAuth callback', 10, {
    customTitle: 'OAuth callback fix',
  })
  const branch = log(branchId, 'Copied root prompt', 20, {
    sessionBranch: branchMeta(
      branchId,
      rootId,
      rootId,
      'Retry token exchange',
    ),
  })

  expect(getResumeLogDisplayTitle(branch)).toBe('Retry token exchange')
  expect(logMatchesResumePickerSearch(branch, 'token exchange')).toBe(true)
  expect(logMatchesResumePickerSearch(root, 'callback fix')).toBe(true)
})

test('requests more logs when grouped branch rows underfill the visible picker', () => {
  expect(
    shouldLoadMoreResumeLogs({
      displayedLogCount: 50,
      focusedIndex: 1,
      visibleCount: 10,
      visibleNodeCount: 1,
    }),
  ).toBe(true)
  expect(
    shouldLoadMoreResumeLogs({
      displayedLogCount: 50,
      focusedIndex: 1,
      visibleCount: 10,
      visibleNodeCount: 10,
    }),
  ).toBe(false)
  expect(
    shouldLoadMoreResumeLogs({
      displayedLogCount: 50,
      focusedIndex: 35,
      visibleCount: 10,
      visibleNodeCount: 10,
    }),
  ).toBe(true)
})
