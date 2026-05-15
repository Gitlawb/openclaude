import { afterEach, describe, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext } from '../../Tool.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  MAX_SUBCOMMANDS_FOR_SECURITY_CHECK,
  bashToolHasPermission,
  stripAllLeadingEnvVars,
} from './bashPermissions.js'

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
  expect(result.message).toContain('passwd')
})

// SEC-06 regression: deny rules must fire even when the denied subcommand sits past
// the MAX_SUBCOMMANDS_FOR_SECURITY_CHECK cap position.
// Previously, the cap returned 'ask' before the deny loop ran, so a command with
// N benign subcommands followed by a denied one escaped the deny rule entirely.
describe('checkSandboxAutoAllow — deny-first invariant with subcommand cap', () => {
  test('deny rule fires when denied subcommand is at position MAX_SUBCOMMANDS_FOR_SECURITY_CHECK', async () => {
    ;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
      VERSION: 'test',
    }

    SandboxManager.isSandboxingEnabled = () => true
    SandboxManager.isAutoAllowBashIfSandboxedEnabled = () => true
    SandboxManager.areUnsandboxedCommandsAllowed = () => true
    SandboxManager.getExcludedCommands = () => []

    // Build a command: (MAX_SUBCOMMANDS_FOR_SECURITY_CHECK - 1) benign echo subcommands
    // followed by a denied `rm -rf /` at exactly position MAX_SUBCOMMANDS_FOR_SECURITY_CHECK
    const benign = Array.from(
      { length: MAX_SUBCOMMANDS_FOR_SECURITY_CHECK - 1 },
      (_, i) => `echo ${i}`,
    ).join(' && ')
    const command = `${benign} && rm -rf /`

    const toolPermissionContext = getEmptyToolPermissionContext()
    ;(toolPermissionContext.alwaysDenyRules as Record<string, string[]>)[
      'cliArg'
    ] = ['Bash(rm:*)']

    const ctx = {
      abortController: new AbortController(),
      options: { isNonInteractiveSession: false },
      getAppState() {
        return { toolPermissionContext }
      },
    } as never

    const result = await bashToolHasPermission({ command }, ctx)

    // Must return 'deny', NOT 'ask'
    expect(result.behavior).toBe('deny')
  })
})

// SEC-02 regression: array subscript with command substitution must NOT be stripped.
// Bash executes FOO[$(cmd)]=val as a side effect; if the pattern matched the
// subscript, the env-var prefix would be stripped while $(cmd) silently ran.
describe('stripAllLeadingEnvVars — SEC-02 subscript expansion guard', () => {
  test('does not strip env var whose subscript contains $()', () => {
    const cmd = 'FOO[$(id)]=val denied_cmd'
    // Pattern must NOT match — command stays intact, deny check sees the full string.
    expect(stripAllLeadingEnvVars(cmd)).toBe(cmd.trim())
  })

  test('does not strip env var whose subscript contains ${var}', () => {
    const cmd = 'ARR[${evil}]=x ls'
    expect(stripAllLeadingEnvVars(cmd)).toBe(cmd.trim())
  })

  test('does not strip env var whose subscript contains a backtick', () => {
    const cmd = 'X[`id`]=1 echo hi'
    expect(stripAllLeadingEnvVars(cmd)).toBe(cmd.trim())
  })

  test('still strips a safe numeric array subscript', () => {
    // FOO[0]=val cmd → cmd (safe, no expansion in subscript)
    expect(stripAllLeadingEnvVars('FOO[0]=val cmd')).toBe('cmd')
  })

  test('still strips a safe identifier array subscript', () => {
    expect(stripAllLeadingEnvVars('ARR[idx]=x ls')).toBe('ls')
  })
})
