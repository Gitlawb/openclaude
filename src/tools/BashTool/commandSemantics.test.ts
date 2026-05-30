import { describe, expect, test } from 'bun:test'
import { interpretCommandResult } from './commandSemantics.js'

// =============================================================================
// interpretCommandResult — exit code semantics per command
// =============================================================================

describe('interpretCommandResult', () => {
  // --- Default semantics (most commands) ---
  describe('default semantics', () => {
    test('exit code 0 = success, no error', () => {
      const result = interpretCommandResult('python script.py', 0, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBeUndefined()
    })

    test('exit code 1 = error', () => {
      const result = interpretCommandResult('python script.py', 1, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 1')
    })

    test('exit code 127 = command not found', () => {
      const result = interpretCommandResult('foobar', 127, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('127')
    })

    test('exit code 126 = permission denied', () => {
      const result = interpretCommandResult('./script.sh', 126, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('126')
    })

    test('exit code 130 = SIGINT (but not treated as interrupted here)', () => {
      const result = interpretCommandResult('long-command', 130, '', '')
      expect(result.isError).toBe(true)
    })
  })

  // --- grep: 0=matches, 1=no matches, 2+=error ---
  describe('grep', () => {
    test('exit code 0 = matches found (not error)', () => {
      const result = interpretCommandResult('grep foo file.txt', 0, 'foo\n', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('grep foo file.txt', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('No matches found')
    })

    test('exit code 2 = real error', () => {
      const result = interpretCommandResult('grep foo file.txt', 2, '', 'No such file')
      expect(result.isError).toBe(true)
    })
  })

  // --- ripgrep: same as grep ---
  describe('rg', () => {
    test('exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('rg pattern', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('rg pattern', 2, '', '')
      expect(result.isError).toBe(true)
    })
  })

  // --- find: 0=success, 1=partial, 2+=error ---
  describe('find', () => {
    test('exit code 0 = success', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 0, 'file.ts\n', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = partial success (not error)', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 1, 'file.ts\n', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('inaccessible')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 2, '', 'Permission denied')
      expect(result.isError).toBe(true)
    })
  })

  // --- diff: 0=same, 1=different, 2+=error ---
  describe('diff', () => {
    test('exit code 0 = files identical', () => {
      const result = interpretCommandResult('diff a.txt b.txt', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('diff a.txt b.txt', 1, '< line1\n> line2', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('diff a.txt b.txt', 2, '', 'No such file')
      expect(result.isError).toBe(true)
    })
  })

  // --- test/[: 0=true, 1=false, 2+=error ---
  describe('test and [', () => {
    test('test exit code 0 = condition true', () => {
      const result = interpretCommandResult('test -f file.txt', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('test exit code 1 = condition false (not error)', () => {
      const result = interpretCommandResult('test -f file.txt', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('false')
    })

    test('[ exit code 1 = condition false (not error)', () => {
      const result = interpretCommandResult('[ -f file.txt ]', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })

  // --- Compound commands ---
  describe('compound commands', () => {
    test('last command determines semantics: grep last', () => {
      const result = interpretCommandResult('cd /tmp && grep foo file.txt', 1, '', '')
      // grep exit code 1 = no matches, not error
      expect(result.isError).toBe(false)
    })

    test('last command determines semantics: python last', () => {
      const result = interpretCommandResult('cd /tmp && python script.py', 1, '', '')
      // python exit code 1 = error
      expect(result.isError).toBe(true)
    })
  })

  // --- systemctl, apt, docker (real-world commands) ---
  describe('system/service commands', () => {
    test('systemctl failure = error', () => {
      const result = interpretCommandResult('systemctl start nginx', 1, '', 'Job for nginx.service failed')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 1')
    })

    test('apt failure = error', () => {
      const result = interpretCommandResult('apt install foo', 100, '', 'Unable to locate package')
      expect(result.isError).toBe(true)
    })

    test('docker failure = error', () => {
      const result = interpretCommandResult('docker run ubuntu', 1, '', 'Unable to find image')
      expect(result.isError).toBe(true)
    })
  })

  // --- linters: 0=clean, 1=violations (not error), 2+=tool error ---
  describe('linters', () => {
    test('ruff exit code 1 = violations found (not error)', () => {
      const result = interpretCommandResult('ruff check app.py', 1, 'E501 Line too long', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Lint violations found')
    })

    test('ruff exit code 0 = clean', () => {
      const result = interpretCommandResult('ruff check app.py', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('ruff exit code 2 = internal error', () => {
      const result = interpretCommandResult('ruff check app.py', 2, '', 'invalid config')
      expect(result.isError).toBe(true)
    })

    test('eslint exit code 1 = violations (not error)', () => {
      const result = interpretCommandResult('eslint src/', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('eslint exit code 2 = fatal config error', () => {
      const result = interpretCommandResult('eslint src/', 2, '', 'Cannot read config')
      expect(result.isError).toBe(true)
    })

    test('flake8 exit code 1 = violations (not error)', () => {
      const result = interpretCommandResult('flake8 app.py', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('biome exit code 1 = violations (not error)', () => {
      const result = interpretCommandResult('biome check .', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })

  // --- type checkers: 0=clean, 1=type errors (not error), 2+=tool error ---
  describe('type checkers', () => {
    test('mypy exit code 1 = type errors found (not error)', () => {
      const result = interpretCommandResult('mypy app.py', 1, 'error: incompatible type', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Type errors found')
    })

    test('mypy exit code 2 = tool error', () => {
      const result = interpretCommandResult('mypy app.py', 2, '', 'cannot find module')
      expect(result.isError).toBe(true)
    })

    test('pyright exit code 1 = errors found (not error)', () => {
      const result = interpretCommandResult('pyright', 1, '', '')
      expect(result.isError).toBe(false)
    })

    // tsc is inverted vs other linters (verified against TypeScript 5.9):
    // exit 1 = CLI/usage error, exit 2 = diagnostics found.
    test('tsc exit code 0 = clean', () => {
      const result = interpretCommandResult('tsc --noEmit', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('tsc exit code 2 = type/syntax errors found (not error)', () => {
      const result = interpretCommandResult('tsc --noEmit', 2, 'TS2322: Type mismatch', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Type errors found')
    })

    test('tsc exit code 1 = CLI/usage error (real failure)', () => {
      const result = interpretCommandResult('tsc --bogusFlag', 1, '', 'Unknown compiler option')
      expect(result.isError).toBe(true)
    })

    test('tsc exit code 3 = config/internal error', () => {
      const result = interpretCommandResult('tsc -p bad.json', 3, '', '')
      expect(result.isError).toBe(true)
    })
  })

  // --- test runners: 0=pass, 1=failures (not error), 2+=runner error ---
  describe('test runners', () => {
    test('pytest exit code 1 = test failures (not error)', () => {
      const result = interpretCommandResult('pytest tests/', 1, '1 failed', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Test failures')
    })

    test('pytest exit code 0 = all passed', () => {
      const result = interpretCommandResult('pytest tests/', 0, '5 passed', '')
      expect(result.isError).toBe(false)
    })

    test('pytest exit code 2 = interrupted/internal error', () => {
      const result = interpretCommandResult('pytest tests/', 2, '', 'INTERNALERROR')
      expect(result.isError).toBe(true)
    })

    test('jest exit code 1 = failures (not error)', () => {
      const result = interpretCommandResult('jest', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('vitest exit code 1 = failures (not error)', () => {
      const result = interpretCommandResult('vitest run', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('npm test exit code 1 = test failures (not error)', () => {
      const result = interpretCommandResult('npm test', 1, '1 failed', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Test failures')
    })

    test('npm test exit code 0 = all passed', () => {
      const result = interpretCommandResult('npm test', 0, '5 passed', '')
      expect(result.isError).toBe(false)
    })

    test('npm test exit code 2 = runner error', () => {
      const result = interpretCommandResult('npm test', 2, '', 'ENOENT')
      expect(result.isError).toBe(true)
    })

    test('npm install exit code 1 = real failure (not a test runner)', () => {
      const result = interpretCommandResult('npm install', 1, '', 'ERR!')
      expect(result.isError).toBe(true)
    })

    test('npm run build exit code 1 = real failure', () => {
      const result = interpretCommandResult('npm run build', 1, '', 'Build failed')
      expect(result.isError).toBe(true)
    })

    test('npm run test exit code 1 = test failures (not error)', () => {
      const result = interpretCommandResult('npm run test', 1, '1 failed', '')
      expect(result.isError).toBe(false)
    })
  })

  // --- npm test in compound command ---
  describe('npm test', () => {
    test('npm test in compound command', () => {
      const result = interpretCommandResult('cd /project && npm test', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })
})
