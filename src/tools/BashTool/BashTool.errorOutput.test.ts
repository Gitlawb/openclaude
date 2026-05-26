import { describe, expect, test } from 'bun:test'
import { BashTool } from './BashTool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { ShellError } from '../../utils/errors.js'
import { formatError } from '../../utils/toolErrors.js'

// Regression for #1231 — non-zero exit must not hide captured stdout/stderr.
// The Bash tool runs with a merged-fd setup (both streams to one file), so
// captured output lives on result.stdout. Before the fix, the throw passed
// stdout='' and put the merged output in the stderr slot of ShellError, which
// worked through formatError but lost the semantic mapping and made it easy
// for the failure path to drop output if downstream consumers only inspected
// stdout. These tests lock the contract: getErrorParts/formatError surface
// the captured output alongside the exit code.

function makeCtx() {
  const toolPermissionContext = getEmptyToolPermissionContext()
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: () => undefined,
    setToolJSX: undefined,
    toolUseId: 'test-bash-error-output',
  } as never
}

async function expectShellError(command: string): Promise<ShellError> {
  try {
    await BashTool.call({ command, description: 'r' } as never, makeCtx())
    throw new Error('expected ShellError')
  } catch (e) {
    if (!(e instanceof ShellError)) throw e
    return e
  }
}

describe('BashTool error output (#1231)', () => {
  test('captured stdout/stderr appear in formatted error on non-zero exit', async () => {
    const err = await expectShellError(
      'echo stdout-line; echo stderr-line >&2; exit 1',
    )
    expect(err.code).toBe(1)
    const formatted = formatError(err)
    expect(formatted).toContain('Exit code 1')
    expect(formatted).toContain('stdout-line')
    expect(formatted).toContain('stderr-line')
  })

  test('"command not found" message reaches the formatted error', async () => {
    const err = await expectShellError('no_such_command_xyz_1231')
    expect(err.code).not.toBe(0)
    const formatted = formatError(err)
    expect(formatted).toContain(`Exit code ${err.code}`)
    expect(formatted.toLowerCase()).toContain('not found')
  })

  test('captured output is carried on the stdout slot (semantic mapping)', async () => {
    const err = await expectShellError('echo merged-line; exit 2')
    expect(err.stdout).toContain('merged-line')
    expect(err.code).toBe(2)
  })

  test('empty-output failure still surfaces the exit code', async () => {
    const err = await expectShellError('exit 1')
    expect(err.code).toBe(1)
    expect(formatError(err)).toBe('Exit code 1')
  })
})
