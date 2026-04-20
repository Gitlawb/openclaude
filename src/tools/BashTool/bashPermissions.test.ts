import { afterEach, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext } from '../../Tool.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { bashToolHasPermission } from './bashPermissions.js'

const originalSandboxMethods = {
  isSandboxingEnabled: SandboxManager.isSandboxingEnabled,
  isAutoAllowBashIfSandboxedEnabled:
    SandboxManager.isAutoAllowBashIfSandboxedEnabled,
  areUnsandboxedCommandsAllowed: SandboxManager.areUnsandboxedCommandsAllowed,
  getExcludedCommands: SandboxManager.getExcludedCommands,
}

afterEach(() => {
  SandboxManager.isSandboxingEnabled =
    originalSandboxMethods.isSandboxingEnabled
  SandboxManager.isAutoAllowBashIfSandboxedEnabled =
    originalSandboxMethods.isAutoAllowBashIfSandboxedEnabled
  SandboxManager.areUnsandboxedCommandsAllowed =
    originalSandboxMethods.areUnsandboxedCommandsAllowed
  SandboxManager.getExcludedCommands = originalSandboxMethods.getExcludedCommands
})

function makeToolUseContext() {
  const toolPermissionContext = getEmptyToolPermissionContext()

  return {
    abortController: new AbortController(),
    options: {
      isNonInteractiveSession: false,
    },
    getAppState() {
      return {
        toolPermissionContext,
      }
    },
  } as never
}

test('sandbox auto-allow still enforces Bash path constraints', async () => {
  ;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
    VERSION: 'test',
  }

  SandboxManager.isSandboxingEnabled = () => true
  SandboxManager.isAutoAllowBashIfSandboxedEnabled = () => true
  SandboxManager.areUnsandboxedCommandsAllowed = () => true
  SandboxManager.getExcludedCommands = () => []

  const result = await bashToolHasPermission(
    { command: 'cat ../../../../../etc/passwd' },
    makeToolUseContext(),
  )

  expect(result.behavior).toBe('ask')
  expect(result.message).toContain('was blocked')
  expect(result.message).toContain('/etc/passwd')
})
