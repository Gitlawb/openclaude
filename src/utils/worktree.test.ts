import { afterEach, expect, test } from 'bun:test'

import {
  _resetGitWorktreeMutationLocksForTesting,
  buildRevParseFailureMessage,
  withGitWorktreeMutationLock,
} from './worktree.js'

afterEach(() => {
  _resetGitWorktreeMutationLocksForTesting()
})

test('withGitWorktreeMutationLock serializes mutations for the same repo', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve
  })

  const first = withGitWorktreeMutationLock('/repo', async () => {
    order.push('first:start')
    await firstGate
    order.push('first:end')
  })

  const second = withGitWorktreeMutationLock('/repo', async () => {
    order.push('second:start')
    order.push('second:end')
  })

  await Promise.resolve()
  await Promise.resolve()
  expect(order).toEqual(['first:start'])

  releaseFirst()
  await Promise.all([first, second])

  expect(order).toEqual([
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ])
})

test('withGitWorktreeMutationLock does not serialize different repos', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve
  })

  const first = withGitWorktreeMutationLock('/repo-a', async () => {
    order.push('a:start')
    await firstGate
    order.push('a:end')
  })

  const second = withGitWorktreeMutationLock('/repo-b', async () => {
    order.push('b:start')
    order.push('b:end')
  })

  await Promise.resolve()
  await Promise.resolve()
  expect(order).toEqual(['a:start', 'b:start', 'b:end'])

  releaseFirst()
  await Promise.all([first, second])
})

test('buildRevParseFailureMessage surfaces git stderr for empty repos (#690)', () => {
  const msg = buildRevParseFailureMessage(
    'HEAD',
    "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n",
    128,
  )
  expect(msg).toContain('Failed to resolve base branch "HEAD"')
  expect(msg).toContain('unknown revision or path')
  expect(msg).toContain('HEAD has no resolvable commit')
})

test('buildRevParseFailureMessage falls back to exit code when stderr empty', () => {
  const msg = buildRevParseFailureMessage('origin/main', '', 1)
  expect(msg).toBe('Failed to resolve base branch "origin/main": exit code 1')
})

test('buildRevParseFailureMessage skips HEAD-specific hint for branch refs', () => {
  const msg = buildRevParseFailureMessage(
    'origin/main',
    'fatal: ambiguous argument',
    128,
  )
  expect(msg).not.toContain('HEAD has no resolvable commit')
  expect(msg).toContain('fatal: ambiguous argument')
})

test('buildRevParseFailureMessage trims trailing whitespace from stderr', () => {
  const msg = buildRevParseFailureMessage('HEAD', '  some error\n\n', 128)
  expect(msg).toContain(': some error (HEAD')
})
