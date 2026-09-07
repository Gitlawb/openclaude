import { expect, test } from 'bun:test'
import { getEventListeners } from 'events'
import { createChildAbortController, linkAbortController } from './abortController.js'

test('foreground agent follows both parent cancellation and its task stop', () => {
  const parent = new AbortController()
  const task = new AbortController()
  const foreground = createChildAbortController(task)
  linkAbortController(parent.signal, foreground)
  parent.abort('user-cancel')
  expect(foreground.signal.reason).toBe('user-cancel')
  expect(task.signal.aborted).toBe(false)
  expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0)

  const nextParent = new AbortController()
  const nextTask = new AbortController()
  const nextForeground = createChildAbortController(nextTask)
  linkAbortController(nextParent.signal, nextForeground)
  nextTask.abort('user-cancel')
  expect(nextForeground.signal.aborted).toBe(true)
  expect(nextParent.signal.aborted).toBe(false)
})

test('background handoff detaches the foreground phase without killing its task', () => {
  const parent = new AbortController()
  const task = new AbortController()
  const foreground = createChildAbortController(task)
  const unlink = linkAbortController(parent.signal, foreground)
  foreground.abort('backgrounded')
  unlink()
  expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0)
  expect(task.signal.aborted).toBe(false)
  parent.abort('user-cancel')
  expect(task.signal.aborted).toBe(false)
  task.abort('user-cancel')
  expect(task.signal.aborted).toBe(true)
})

test('already cancelled parent prevents a late foreground phase from starting', () => {
  const parent = new AbortController()
  const child = new AbortController()
  parent.abort('user-cancel')
  linkAbortController(parent.signal, child)()
  expect(child.signal.reason).toBe('user-cancel')
})
