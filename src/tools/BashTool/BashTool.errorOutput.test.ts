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
    const err = await expectShellError('printf "not found\\n" >&2; exit 127')
    expect(err.code).toBe(127)
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

  test('query-timeout abort returns cancellation metadata and specific message', async () => {
    const ctx = makeCtx() as {
      abortController: AbortController
    }

    setTimeout(() => ctx.abortController.abort('query-timeout'), 50).unref()

    const response = await BashTool.call(
      { command: 'sleep 5', description: 'wait' } as never,
      ctx as never,
    )

    expect(response.data?.interrupted).toBe(true)
    expect(response.data?.isAbort).toBe(true)
    expect(response.data?.abortReason).toBe('query-timeout')
    expect(response.data?.abortMessage).toBe(
      'Command was interrupted because the query hit its timeout.',
    )

    const toolResult = BashTool.mapToolResultToToolResultBlockParam(
      response.data!,
      'toolu_timeout',
    )
    expect(toolResult.is_error).toBe(true)
    expect(String(toolResult.content)).toContain(
      'Command was interrupted because the query hit its timeout.',
    )
  })

  test('user-cancel abort returns cancellation metadata without treating exit 1 as abort', async () => {
    const ctx = makeCtx() as {
      abortController: AbortController
    }

    setTimeout(() => ctx.abortController.abort('user-cancel'), 50).unref()

    const response = await BashTool.call(
      { command: 'sleep 5', description: 'wait' } as never,
      ctx as never,
    )

    expect(response.data?.interrupted).toBe(true)
    expect(response.data?.isAbort).toBe(true)
    expect(response.data?.abortReason).toBe('user-abort')
    expect(response.data?.abortMessage).toBe(
      'Command was interrupted because the enclosing query was aborted.',
    )

    // Negative case: a separate non-aborted command failure must remain an
    // ordinary ShellError without inheriting abort metadata from this test.
    const err = await expectShellError('exit 1')
    expect(err.interrupted).toBe(false)
    expect(err.abortReason).toBeUndefined()
  })
})
