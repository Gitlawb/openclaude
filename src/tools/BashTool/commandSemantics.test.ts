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

  // --- #1436 linters/test-runners + common package runners ---
  describe('linters, test-runners, and package runners', () => {
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
      expect(result.message).toContain('exit code 2')
    })

    test('eslint exit code 1 = lint problems (not error)', () => {
      const result = interpretCommandResult('eslint src/', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('eslint exit code 2 = fatal config error', () => {
      const result = interpretCommandResult('eslint src/', 2, '', 'Cannot read config file')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 2')
    })

    test('additional linters and formatters report exit 1 as diagnostics', () => {
      for (const command of [
        'flake8 .',
        'biome check .',
        'mypy .',
        'pyright',
        'prettier --check .',
        'black --check .',
      ]) {
        const result = interpretCommandResult(command, 1, 'diagnostics', '')
        expect(result.isError).toBe(false)
      }
    })

    test('test runners report exit 1 as test failures', () => {
      for (const command of ['pytest', 'jest', 'vitest run']) {
        const result = interpretCommandResult(command, 1, '1 failed', '')
        expect(result.isError).toBe(false)
      }
    })

    test('tsc diagnostic exits report type errors while usage failures stay errors', () => {
      expect(
        interpretCommandResult('tsc --build', 1, 'error TS2322', '').isError,
      ).toBe(false)
      expect(
        interpretCommandResult('tsc --noEmit', 2, 'error TS2322', '').isError,
      ).toBe(false)
      expect(
        interpretCommandResult('tsc --bogus', 1, '', 'unknown option').isError,
      ).toBe(true)
      expect(
        interpretCommandResult(
          'tsc --bogus',
          1,
          '',
          "error TS5023: Unknown compiler option '--bogus'.",
        ).isError,
      ).toBe(true)
    })

    test('pylint diagnostic bits are reported, usage-error bit is an error', () => {
      expect(
        interpretCommandResult('pylint app.py', 30, 'E/W/R/C', '').isError,
      ).toBe(false)
      expect(
        interpretCommandResult('pylint --bogus', 32, '', 'usage error').isError,
      ).toBe(true)
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

    test('value-taking wrapper flags skip their values before resolving the tool', () => {
      const cases = [
        ['npx -p typescript tsc --noEmit', 2],
        ['uvx --from ruff ruff check .', 1],
        ['pipx run --spec ruff ruff check .', 1],
        ['uvx --python 3.12 ruff check .', 1],
        ['uvx --cache-dir /tmp/uv-cache ruff check .', 1],
        ['uvx --env-file .env ruff check .', 1],
      ] as const
      for (const [command, exitCode] of cases) {
        const result = interpretCommandResult(command, exitCode, 'diagnostics', '')
        expect(result.isError).toBe(false)
      }
    })

    test('python -m, bunx, pipx run, and package-manager exec resolve the wrapped tool', () => {
      const cases = [
        ['python -m ruff check .', 1],
        ['python3 -m pytest', 1],
        ['bunx vitest run', 1],
        ['pipx run black --check .', 1],
        ['npm exec eslint .', 1],
        ['npm x eslint .', 1],
        ['npm exec --workspace pkg eslint .', 1],
        ['pnpm exec tsc --noEmit', 2],
        ['pnpm exec --filter pkg tsc --noEmit', 2],
        ['pnpm eslint .', 1],
        ['pnpm --filter pkg exec tsc --noEmit', 2],
        ['yarn exec eslint .', 1],
        ['yarn exec --cwd pkg eslint .', 1],
        ['yarn eslint .', 1],
        ['yarn workspace pkg exec eslint .', 1],
        ['bun x biome check .', 1],
      ] as const
      for (const [command, exitCode] of cases) {
        const result = interpretCommandResult(command, exitCode, 'diagnostics', '')
        expect(result.isError).toBe(false)
      }
    })

    test('common package scripts inherit diagnostic semantics for known script aliases', () => {
      const cases = [
        ['npm run lint', 1],
        ['npm run --silent lint', 1],
        ['npm run -s lint', 1],
        ['npm run-script lint', 1],
        ['npm --workspace pkg run lint', 1],
        ['npm -w pkg test', 1],
        ['npm test', 1],
        ['yarn lint', 1],
        ['yarn run lint', 1],
        ['yarn --cwd pkg lint', 1],
        ['yarn workspace pkg run test', 1],
        ['yarn test', 1],
        ['yarn run test', 1],
        ['pnpm lint', 1],
        ['pnpm run lint', 1],
        ['pnpm --filter pkg run lint', 1],
        ['pnpm --dir pkg run test', 1],
        ['pnpm test', 1],
        ['pnpm run test', 1],
        ['npm run typecheck', 2],
        ['npm --workspace pkg exec eslint .', 1],
        ['pnpm typecheck', 2],
        ['pnpm run typecheck', 2],
        ['yarn typecheck', 2],
        ['yarn run typecheck', 2],
      ] as const
      for (const [command, exitCode] of cases) {
        const result = interpretCommandResult(command, exitCode, 'diagnostics', '')
        expect(result.isError).toBe(false)
      }
    })

    test('environment prefixes keep linter and test-runner semantics with path values', () => {
      const cases = [
        ['PYTHONPATH=./src pytest tests/', 1],
        ['env RUFF_CACHE_DIR=/tmp/cache ruff check .', 1],
        ['env CI=1 uvx ruff check .', 1],
        ['env -- RUFF_CACHE_DIR=/tmp/cache ruff check .', 1],
        ['env -S "ruff check ."', 1],
        ['env -S "eslint ."', 1],
        ['env -S "pytest -q"', 1],
        ['env -S="tsc --noEmit" ruff', 2],
        ['env --split-string="ruff check ."', 1],
        ['env --split-string="python -m pytest"', 1],
        ['env --split-string="uvx ruff check ."', 1],
        ['env --split-string="npx eslint ."', 1],
        ['env --split-string="npx -p typescript tsc --noEmit"', 2],
        ['env --split-string="PYTHONPATH=./src pytest tests/"', 1],
        ['env --split-string="RUFF_CACHE_DIR=/tmp/cache ruff check ."', 1],
      ] as const
      for (const [command, exitCode] of cases) {
        const result = interpretCommandResult(command, exitCode, 'diagnostics', '')
        expect(result.isError).toBe(false)
      }
    })

    test('uvx wrapping an unrecognized tool falls back to default: exit 1 = error', () => {
      const result = interpretCommandResult('uvx somecli run', 1, '', '')
      expect(result.isError).toBe(true)
    })

    test('bare npx with no recognized tool uses default semantics', () => {
      const result = interpretCommandResult('npx', 1, '', '')
      expect(result.isError).toBe(true)
    })

    test('non-runner forms still use default semantics', () => {
      for (const command of ['python script.py', 'pipx list', 'bun run build']) {
        const result = interpretCommandResult(command, 1, '', 'failed')
        expect(result.isError).toBe(true)
      }
    })

    test('failed setup before && does not inherit linter semantics', () => {
      for (const [command, stderr] of [
        [
          'cd missing && ruff check .',
          'bash: line 1: cd: missing: No such file or directory',
        ],
        [
          'pushd missing && pytest',
          'bash: line 1: pushd: missing: No such file or directory',
        ],
        [
          'echo setup && cd missing && ruff check .',
          'bash: line 1: cd: missing: No such file or directory',
        ],
      ] as const) {
        const stdout = command.startsWith('echo setup') ? 'setup\n' : ''
        const result = interpretCommandResult(command, 1, stdout, stderr)
        expect(result.isError).toBe(true)
      }
    })

    test('silent short-circuited setup before && stays a command error', () => {
      for (const command of [
        'false && ruff check .',
        'test -f missing && ruff check .',
        'cd missing && ruff check .',
      ]) {
        const result = interpretCommandResult(command, 1, '', '')
        expect(result.isError).toBe(true)
      }
    })

    test('failed pipeline input does not inherit linter or test-runner semantics', () => {
      for (const [command, stderr] of [
        ['cat missing | pytest', 'cat: missing: No such file or directory'],
        ['cat missing | ruff check .', 'cat: missing: No such file or directory'],
        [
          'cat missing | eslint --stdin',
          'cat: missing: No such file or directory',
        ],
        [
          'missingcmd | pytest',
          'bash: line 1: missingcmd: command not found',
        ],
        [
          'env missingcmd | ruff check .',
          'env: missingcmd: No such file or directory',
        ],
        [
          'echo setup && cat missing | pytest',
          'cat: missing: No such file or directory',
        ],
      ] as const) {
        const stdout = command.startsWith('echo setup') ? 'setup\n' : ''
        const result = interpretCommandResult(command, 1, stdout, stderr)
        expect(result.isError).toBe(true)
      }
    })

    test('silent failed pipeline input stays a command error', () => {
      for (const command of ['false | pytest', 'test -f missing | ruff check .']) {
        const result = interpretCommandResult(command, 1, '', '')
        expect(result.isError).toBe(true)
      }
    })

    test('BashTool merged-output setup failures do not inherit linter or test-runner semantics', () => {
      for (const [command, stdout] of [
        [
          'echo setup && cd missing && ruff check .',
          'setup\nbash: line 1: cd: missing: No such file or directory\n',
        ],
        [
          'echo setup && cat missing | pytest',
          'setup\ncat: missing: No such file or directory\n',
        ],
        [
          'missingcmd | pytest',
          'bash: line 1: missingcmd: command not found\n',
        ],
        [
          'env missingcmd | ruff check .',
          'env: missingcmd: No such file or directory\n',
        ],
      ] as const) {
        const result = interpretCommandResult(command, 1, stdout, '')
        expect(result.isError).toBe(true)
      }
    })

    test('successful setup before && still lets linter diagnostics through', () => {
      const result = interpretCommandResult('cd src && ruff check .', 1, 'F401', '')
      expect(result.isError).toBe(false)
    })

    test('successful setup with empty diagnostic output keeps diagnostic semantics', () => {
      const result = interpretCommandResult('echo hi && ruff check .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('diagnostics after successful setup can mention missing files', () => {
      for (const command of [
        'cd src && pytest',
        'cd src && ruff check .',
        'pytest -k "missing|fixture"',
        'pytest -k "missing&&fixture"',
      ]) {
        const result = interpretCommandResult(
          command,
          1,
          '',
          'FileNotFoundError: No such file or directory: fixture.txt',
        )
        expect(result.isError).toBe(false)
      }
    })

    test('package-runner failures do not inherit wrapped-tool semantics', () => {
      const cases = [
        ['npx eslint .', '', 'npm ERR! code EAI_AGAIN'],
        ['npx eslint .', '', 'npm error code EAI_AGAIN'],
        ['npx eslint .', 'Installing eslint...', 'npm ERR! code EAI_AGAIN'],
        ['npm run lint', 'Running lint...', 'npm error code EAI_AGAIN'],
        ['npx eslint .', 'Installing eslint...\nnpm ERR! code EAI_AGAIN', ''],
        ['npm run lint', 'Running lint...', 'npm ERR! code EAI_AGAIN'],
        ['env -S "npx eslint ."', 'Installing eslint...\nnpm ERR! code EAI_AGAIN', ''],
        ['env --split-string="npx eslint ."', 'Installing eslint...\nnpm ERR! code EAI_AGAIN', ''],
        ['uvx ruff check .', 'Resolving packages...', 'error: Failed to download ruff'],
        ['uvx ruff check .', 'Resolving packages...\nerror: Failed to download ruff', ''],
        ['pipx run black --check .', '', 'Fatal error from pip prevented installation'],
        ['pipx run black --check .', 'Fatal error from pip prevented installation', ''],
      ] as const
      for (const [command, stdout, stderr] of cases) {
        const result = interpretCommandResult(command, 1, stdout, stderr)
        expect(result.isError).toBe(true)
      }
    })

    test('package script diagnostic exits ignore generic lifecycle noise', () => {
      const cases = [
        [
          'npm test',
          '1 failed\nnpm error code ELIFECYCLE\nnpm error Test failed.',
        ],
        [
          'npm run test',
          '1 failed\nnpm error code ELIFECYCLE\nnpm error Command failed with exit code 1.',
        ],
        [
          'npm run lint',
          'F401\nnpm error code ELIFECYCLE\nnpm error Command failed with exit code 1.',
        ],
        [
          'pnpm test',
          '1 failed\npnpm ERR! Command failed with exit code 1.',
        ],
        [
          'pnpm run lint',
          'F401\npnpm error Command failed with exit code 1.',
        ],
      ] as const
      for (const [command, stdout] of cases) {
        const result = interpretCommandResult(command, 1, stdout, '')
        expect(result.isError).toBe(false)
      }
    })

    test('wrapped tool diagnostics that mention failed resolution remain diagnostics', () => {
      const output =
        'Error: Failed to resolve import "./missing" from "src/example.test.ts". Does the file exist?'
      for (const command of ['npx vitest run', 'bunx vitest run']) {
        const result = interpretCommandResult(command, 1, output, '')
        expect(result.isError).toBe(false)
      }
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
