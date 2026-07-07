import { describe, expect, test } from 'bun:test'
import { interpretCommandResult } from './commandSemantics.js'

// ---------------------------------------------------------------------------
// interpretCommandResult — PowerShell exit-code semantics per command
// ---------------------------------------------------------------------------

describe('interpretCommandResult (PowerShell)', () => {
  describe('default semantics', () => {
    test('exit code 0 = success', () => {
      const result = interpretCommandResult('python script.py', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = error for a plain command', () => {
      const result = interpretCommandResult('python script.py', 1, '', '')
      expect(result.isError).toBe(true)
    })
  })

  describe('grep / robocopy (existing behavior)', () => {
    test('grep exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('grep foo file.txt', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('robocopy exit code 1 = files copied (not error)', () => {
      const result = interpretCommandResult('robocopy src dst', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })

  // The reported bug (#1436) was observed on Windows with `uvx ruff check --fix`.
  describe('linters (ruff / eslint) and uvx / npx wrappers', () => {
    test('ruff exit code 1 = violations found (not error)', () => {
      const result = interpretCommandResult('ruff check --fix', 1, 'F401\n', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('violations')
    })

    test('ruff exit code 2 = real error', () => {
      const result = interpretCommandResult('ruff check .', 2, '', 'invalid config')
      expect(result.isError).toBe(true)
    })

    test('ruff.exe strips suffix and inherits lint semantics', () => {
      const result = interpretCommandResult('ruff.exe check .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('eslint exit code 1 = lint problems (not error)', () => {
      const result = interpretCommandResult('eslint src/', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('eslint exit code 2 = fatal config error', () => {
      const result = interpretCommandResult('eslint src/', 2, '', 'Cannot read config')
      expect(result.isError).toBe(true)
    })

    test('uvx ruff check inherits ruff semantics: exit 1 not error', () => {
      const result = interpretCommandResult('uvx ruff check --fix', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('npx eslint inherits eslint semantics: exit 1 not error', () => {
      const result = interpretCommandResult('npx eslint .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('npx with flags before the tool still unwraps', () => {
      const result = interpretCommandResult('npx -y eslint .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('uvx wrapping an unrecognized tool falls back to default: exit 1 = error', () => {
      const result = interpretCommandResult('uvx somecli run', 1, '', '')
      expect(result.isError).toBe(true)
    })

    test('bare npx with no recognized tool uses default semantics', () => {
      const result = interpretCommandResult('npx', 1, '', '')
      expect(result.isError).toBe(true)
    })

    // #1846 review: Windows npm-installed tools/wrappers are invoked via `.cmd`
    // shims. These must normalize the same way `.exe` does, or the exit-1 lint
    // fix regresses on the PowerShell path (they fell back to default and
    // reported isError: true).
    test('eslint.cmd shim strips suffix and inherits lint semantics', () => {
      const result = interpretCommandResult('eslint.cmd src/', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('ruff.cmd shim strips suffix and inherits lint semantics', () => {
      const result = interpretCommandResult('ruff.cmd check .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('path-prefixed eslint.cmd shim inherits lint semantics', () => {
      const result = interpretCommandResult(
        '.\\node_modules\\.bin\\eslint.cmd .',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
    })

    test('npx.cmd wrapper shim unwraps to eslint semantics: exit 1 not error', () => {
      const result = interpretCommandResult('npx.cmd eslint .', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })
})
