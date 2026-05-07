import { afterEach, expect, test } from 'bun:test'

import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { BashTool } from './BashTool.js'
import { PowerShellTool } from '../PowerShellTool/PowerShellTool.js'
import { shouldUseSandbox } from './shouldUseSandbox.js'

const originalSandboxMethods = {
  isSandboxingEnabled: SandboxManager.isSandboxingEnabled,
  areUnsandboxedCommandsAllowed: SandboxManager.areUnsandboxedCommandsAllowed,
}

afterEach(() => {
  SandboxManager.isSandboxingEnabled =
    originalSandboxMethods.isSandboxingEnabled
  SandboxManager.areUnsandboxedCommandsAllowed =
    originalSandboxMethods.areUnsandboxedCommandsAllowed
})

test('model-facing Bash schema rejects dangerouslyDisableSandbox', () => {
  const result = BashTool.inputSchema.safeParse({
    command: 'cat /etc/passwd',
    dangerouslyDisableSandbox: true,
  })

  expect(result.success).toBe(false)
})

test('model-facing PowerShell schema rejects dangerouslyDisableSandbox', () => {
  const result = PowerShellTool.inputSchema.safeParse({
    command: 'Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts',
    dangerouslyDisableSandbox: true,
  })

  expect(result.success).toBe(false)
})

test('model-controlled dangerouslyDisableSandbox does not bypass sandbox', () => {
  SandboxManager.isSandboxingEnabled = () => true
  SandboxManager.areUnsandboxedCommandsAllowed = () => true

  expect(
    shouldUseSandbox({
      command: 'cat /etc/passwd',
      dangerouslyDisableSandbox: true,
    }),
  ).toBe(true)
})

test('trusted internal approval can disable sandbox when policy allows it', () => {
  SandboxManager.isSandboxingEnabled = () => true
  SandboxManager.areUnsandboxedCommandsAllowed = () => true

  expect(
    shouldUseSandbox({
      command: 'cat /etc/passwd',
      dangerouslyDisableSandbox: true,
      _dangerouslyDisableSandboxApproved: true,
    }),
  ).toBe(false)
})

test('trusted internal approval cannot disable sandbox when policy forbids it', () => {
  SandboxManager.isSandboxingEnabled = () => true
  SandboxManager.areUnsandboxedCommandsAllowed = () => false

  expect(
    shouldUseSandbox({
      command: 'cat /etc/passwd',
      dangerouslyDisableSandbox: true,
      _dangerouslyDisableSandboxApproved: true,
    }),
  ).toBe(true)
})
