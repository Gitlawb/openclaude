import { afterEach, expect, test } from 'bun:test'

import {
  _resetGitWorktreeMutationLocksForTesting,
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
