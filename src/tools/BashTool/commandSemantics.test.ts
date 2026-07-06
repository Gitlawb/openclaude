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

  // --- ruff / eslint (linters) + uvx / npx wrappers ---
  describe('linters and wrappers', () => {
    test('ruff exit code 0 = clean', () => {
      const result = interpretCommandResult('ruff check .', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('ruff exit code 1 = violations found (not error)', () => {
      const result = interpretCommandResult('ruff check --fix', 1, 'F401 imported but unused\n', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('violations')
    })

    test('ruff exit code 2 = real error', () => {
      const result = interpretCommandResult('ruff check .', 2, '', 'invalid pyproject config')
      expect(result.isError).toBe(true)
    })

    test('eslint exit code 1 = lint problems (not error)', () => {
      const result = interpretCommandResult('eslint src/', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('eslint exit code 2 = fatal config error', () => {
      const result = interpretCommandResult('eslint src/', 2, '', 'Cannot read config file')
      expect(result.isError).toBe(true)
    })

    test('uvx ruff inherits ruff semantics: exit 1 not error', () => {
      const result = interpretCommandResult('uvx ruff check --fix', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('npx eslint inherits eslint semantics: exit 1 not error', () => {
      const result = interpretCommandResult('npx eslint .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('npx with flags before the tool still unwraps: exit 1 not error', () => {
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

    test('path-prefixed eslint inherits lint semantics: exit 1 not error', () => {
      const result = interpretCommandResult(
        './node_modules/.bin/eslint .',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
    })

    test('quoted linter inherits lint semantics: exit 1 not error', () => {
      const result = interpretCommandResult('"ruff" check .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('path-prefixed uvx wrapper unwraps to ruff: exit 1 not error', () => {
      const result = interpretCommandResult(
        '/usr/bin/uvx ruff check --fix',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
    })

    test('npx wrapping a path-prefixed eslint unwraps: exit 1 not error', () => {
      const result = interpretCommandResult(
        'npx ./node_modules/.bin/eslint .',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
    })

    test('path-prefixed linter still surfaces a real error: exit 2 = error', () => {
      const result = interpretCommandResult(
        './node_modules/.bin/eslint .',
        2,
        '',
        'Invalid config',
      )
      expect(result.isError).toBe(true)
    })
  })
})
