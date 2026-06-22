import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import * as realLog from '../log.js'

let importCounter = 0

beforeEach(async () => {
  await acquireSharedMutationLock('utils/bash/shellQuote.test.ts')
})

async function importShellQuoteWithLogSpy(
  logErrorSpy: ReturnType<typeof mock<(error: Error) => void>>,
) {
  mock.module('../log.js', () => ({
    ...realLog,
    logError: logErrorSpy,
  }))

  return import(`./shellQuote.js?shellQuoteTest=${importCounter++}`)
}

afterEach(() => {
  try {
    mock.restore()
    mock.module('../log.js', () => realLog)
  } finally {
    releaseSharedMutationLock()
  }
})

test('parses valid shell expansion normally', async () => {
  const logErrorSpy = mock((_error: Error) => {})
  const { tryParseShellCommand } =
    await importShellQuoteWithLogSpy(logErrorSpy)

  const result = tryParseShellCommand('echo $VALUE', key => `<${key}>`)

  expect(result).toEqual({
    success: true,
    tokens: ['echo', '<VALUE>'],
  })
  expect(logErrorSpy).not.toHaveBeenCalled()
})

test('classifies shell-quote Bad substitution as an expected parser limitation without error logging', async () => {
  const logErrorSpy = mock((_error: Error) => {})
  const { tryParseShellCommand } =
    await importShellQuoteWithLogSpy(logErrorSpy)

  const result = tryParseShellCommand('echo ${value + 1}')

  expect(result.success).toBe(false)
  if (result.success) {
    throw new Error('expected parse failure')
  }
  expect(result.failureKind).toBe('expected-limitation')
  expect(result.reasonCode).toBe('bad-substitution')
  expect(result.error).toBe('Bad substitution: value')
  expect(logErrorSpy).not.toHaveBeenCalled()
})

test('still logs unexpected parser defects', async () => {
  const logErrorSpy = mock((_error: Error) => {})
  const { tryParseShellCommand } =
    await importShellQuoteWithLogSpy(logErrorSpy)

  const result = tryParseShellCommand('echo $VALUE', () => {
    throw new Error('test parser defect')
  })

  expect(result.success).toBe(false)
  if (result.success) {
    throw new Error('expected parse failure')
  }
  expect(result.failureKind).toBe('unexpected-error')
  expect(result.reasonCode).toBe('unexpected-error')
  expect(logErrorSpy).toHaveBeenCalledTimes(1)
})
