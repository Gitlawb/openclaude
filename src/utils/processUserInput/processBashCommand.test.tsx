import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { BashTool } from '../../tools/BashTool/BashTool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getContentText } from '../messages.js'
import { processBashCommand } from './processBashCommand.js'

const originalCall = BashTool.call

beforeEach(async () => {
  await acquireSharedMutationLock('utils/processUserInput/processBashCommand.test.tsx')
})

afterEach(() => {
  try {
    BashTool.call = originalCall
  } finally {
    releaseSharedMutationLock()
  }
})

function makeContext() {
  return {
    abortController: new AbortController(),
    options: {
      verbose: false,
      isNonInteractiveSession: false,
    },
    getAppState() {
      return {
        toolPermissionContext: getEmptyToolPermissionContext(),
      }
    },
  } as never
}

test('processBashCommand returns successful shell output as visible bash stdout', async () => {
  BashTool.call = (async () => ({
    data: {
      stdout: 'visible-1265\n',
      stderr: '',
      interrupted: false,
    },
  })) as unknown as typeof BashTool.call

  const result = await processBashCommand(
    'printf visible-1265',
    [],
    [],
    makeContext(),
    () => {},
  )

  expect(result.shouldQuery).toBe(false)

  const visibleText = result.messages
    .filter(message => message.type === 'user' && !message.isMeta)
    .map(message => getContentText(message.message.content))
    .join('\n')

  expect(visibleText).toContain('<bash-input>printf visible-1265</bash-input>')
  expect(visibleText).toContain('<bash-stdout>visible-1265')
})

test('processBashCommand preserves background task metadata', async () => {
  BashTool.call = (async () => ({
    data: {
      stdout: '',
      stderr: '',
      interrupted: false,
      backgroundTaskId: 'bg-review-1',
      backgroundedByUser: true,
    },
  })) as unknown as typeof BashTool.call

  const result = await processBashCommand(
    'sleep 60',
    [],
    [],
    makeContext(),
    () => {},
  )

  expect(result.shouldQuery).toBe(false)

  const visibleText = result.messages
    .filter(message => message.type === 'user' && !message.isMeta)
    .map(message => getContentText(message.message.content))
    .join('\n')

  expect(visibleText).toContain('Command was manually backgrounded by user')
  expect(visibleText).toContain('bg-review-1')
  expect(visibleText).toContain('Output is being written to:')
})
