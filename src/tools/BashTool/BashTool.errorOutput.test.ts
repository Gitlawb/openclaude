import { describe, expect, test } from 'bun:test'
import {
  BashTool,
  appendPersistedOutputHint,
  MAX_PERSISTED_SHELL_OUTPUT_SIZE,
} from './BashTool.js'
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

  // Regression for #1359 — when the captured output rolls to a file because
  // it exceeds getMaxOutputLength (default 30k bytes) AND the command exits
  // non-zero, the model used to see only the truncated first chunk on
  // result.stdout with no signal that the rest existed. The error path now
  // persists the roll file into the tool-results dir and appends a marker
  // pointing at it, so the model can FileRead the full output.
  test('large-output non-zero exit persists output and embeds path in error', async () => {
    // Generate ~50k bytes (well above BASH_MAX_OUTPUT_DEFAULT=30000) then
    // exit non-zero. The shell's rolling-file path engages once the in-memory
    // accumulator exceeds the cap.
    const err = await expectShellError(
      `for i in $(seq 1 700); do printf 'line %04d %s\\n' "$i" "padding-to-make-this-line-fat-enough-to-cross-the-limit"; done; exit 1`,
    )
    expect(err.code).toBe(1)
    const formatted = formatError(err)
    expect(formatted).toContain('Exit code 1')
    // The marker tells the model the full output is on disk along with the
    // byte count. We don't pin the exact path (it's a temp dir) but we do
    // require the canonical phrasing so the model's prompt template can
    // anchor on it.
    expect(formatted).toMatch(/full output \(\d+ bytes\) saved to .+; read with the Read tool/)
  })

  // Follow-up to #1359 — persistShellOutputFile caps the saved roll file at
  // MAX_PERSISTED_SHELL_OUTPUT_SIZE. When that cap engages the error marker
  // must NOT claim the full output is on disk, or the model trusts a truncated
  // file and can miss a failure that appears past the cap.
  test('hint reports a cap instead of "full output" when the roll file was truncated', () => {
    const original = MAX_PERSISTED_SHELL_OUTPUT_SIZE + 4096
    const hint = appendPersistedOutputHint('preview', '/tmp/out', original, true)
    expect(hint).not.toContain('full output')
    expect(hint).toContain('capped')
    expect(hint).toContain(`first ${MAX_PERSISTED_SHELL_OUTPUT_SIZE} bytes`)
    expect(hint).toContain(`${original}-byte`)
    expect(hint).toContain('/tmp/out')
  })

  test('hint keeps "full output" wording when the roll file fit under the cap', () => {
    const hint = appendPersistedOutputHint('preview', '/tmp/out', 1234, false)
    expect(hint).toMatch(/full output \(1234 bytes\) saved to \/tmp\/out; read with the Read tool/)
  })
})
