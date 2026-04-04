import { expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { checkPermissionMode } from './modeValidation.js'

const acceptEditsContext = {
  ...getEmptyToolPermissionContext(),
  mode: 'acceptEdits' as const,
}

test('acceptEdits does not auto-allow read commands with output redirection', () => {
  const result = checkPermissionMode(
    { command: 'echo hello > output.txt' } as never,
    acceptEditsContext,
  )

  expect(result.behavior).toBe('passthrough')
})

test('acceptEdits does not auto-allow mutating find invocations', () => {
  const result = checkPermissionMode(
    { command: 'find . -delete' } as never,
    acceptEditsContext,
  )

  expect(result.behavior).toBe('passthrough')
})

test('acceptEdits still auto-allows safe read-only commands', () => {
  const result = checkPermissionMode(
    { command: 'grep foo package.json' } as never,
    acceptEditsContext,
  )

  expect(result.behavior).toBe('allow')
})

test('acceptEdits still blocks dangerous rm paths even in auto-allow mode', () => {
  const result = checkPermissionMode(
    { command: 'rm -rf ~' } as never,
    acceptEditsContext,
  )

  expect(result.behavior).toBe('ask')
})
