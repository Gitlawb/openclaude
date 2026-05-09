import { EventEmitter } from 'events'
import { expect, test } from 'bun:test'
import { wrapSpawn } from './ShellCommand.js'
import { TaskOutput } from './task/TaskOutput.js'

function createMockChildProcess(): EventEmitter & {
  pid?: number
  stdout: null
  stderr: null
} {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number
    stdout: null
    stderr: null
  }
  child.stdout = null
  child.stderr = null
  child.pid = undefined
  return child
}

test('interrupt kills running shell commands', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-running', null),
  )

  controller.abort('interrupt')

  const result = await command.result
  expect(command.status).toBe('killed')
  expect(result.interrupted).toBe(true)
  expect(result.code).toBe(137)
})

test('interrupt does not kill backgrounded shell commands', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-backgrounded', null),
  )

  expect(command.background('bg-task')).toBe(true)
  controller.abort('interrupt')

  await Promise.resolve()
  expect(command.status).toBe('backgrounded')

  child.emit('exit', 0, null)
  const result = await command.result
  expect(result.code).toBe(0)
  expect(result.backgroundTaskId).toBe('bg-task')
})

test('interrupt does not kill keep-alive commands used by asyncRewake hooks', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-keepalive', null),
    false,
    undefined,
    { keepAliveOnInterrupt: true },
  )

  controller.abort('interrupt')

  await Promise.resolve()
  expect(command.status).toBe('running')

  child.emit('exit', 2, null)
  const result = await command.result
  expect(result.code).toBe(2)
  expect(result.interrupted).toBe(false)
})
