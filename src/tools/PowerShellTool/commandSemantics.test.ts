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
  describe('linters, test-runners, and package runners', () => {
    test('ruff exit code 1 = violations found (not error)', () => {
      const result = interpretCommandResult('ruff check --fix', 1, 'F401\n', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('violations')
    })

    test('ruff exit code 2 = real error', () => {
      const result = interpretCommandResult('ruff check .', 2, '', 'invalid config')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 2')
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

    test('value-taking wrapper flags skip their values before resolving the tool', () => {
      const cases = [
        ['npx -p typescript tsc --noEmit', 2],
        ['uvx --from ruff ruff check .', 1],
        ['pipx run --spec ruff ruff check .', 1],
        ['uvx --python 3.12 ruff check .', 1],
        ['uvx --cache-dir C:\\tmp\\uv-cache ruff check .', 1],
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
        ['pnpm exec -F pkg tsc --noEmit', 2],
        ['pnpm exec -C pkg tsc --noEmit', 2],
        ['pnpm eslint .', 1],
        ['pnpm --filter pkg exec tsc --noEmit', 2],
        ['pnpm -F pkg exec tsc --noEmit', 2],
        ['pnpm -C pkg exec tsc --noEmit', 2],
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
        ['pnpm -F pkg run lint', 1],
        ['pnpm --dir pkg run test', 1],
        ['pnpm -C pkg run test', 1],
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
        ['PYTHONPATH=C:\\repo pytest tests/', 1],
        ['env RUFF_CACHE_DIR=C:\\tmp\\ruff ruff check .', 1],
        ['env CI=1 uvx ruff check .', 1],
        ['env -- RUFF_CACHE_DIR=C:\\tmp\\ruff ruff check .', 1],
        ['env -S "ruff check ."', 1],
        ['env -S "eslint ."', 1],
        ['env -S "pytest -q"', 1],
        ['env -S="tsc --noEmit" ruff', 2],
        ['env --split-string="ruff check ."', 1],
        ['env --split-string="python -m pytest"', 1],
        ['env --split-string="uvx ruff check ."', 1],
        ['env --split-string="npx eslint ."', 1],
        ['env --split-string="npx -p typescript tsc --noEmit"', 2],
        ['env --split-string="PYTHONPATH=C:\\repo pytest tests/"', 1],
        ['env --split-string="RUFF_CACHE_DIR=C:\\tmp\\ruff ruff check ."', 1],
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
      for (const [command, stdout] of [
        ['Set-Location missing && ruff check .', ''],
        ['cd missing && ruff check .', ''],
        ['Set-Location missing & ruff check .', ''],
        ['Write-Output setup; Set-Location missing && ruff check .', 'setup\n'],
      ] as const) {
        const result = interpretCommandResult(
          command,
          1,
          stdout,
          'Set-Location: Cannot find path missing because it does not exist.',
        )
        expect(result.isError).toBe(true)
      }
    })

    test('alias-invoked setup failures match resolved cmdlet errors', () => {
      for (const [command, stderr] of [
        [
          'cd missing && ruff check .',
          'Set-Location : Cannot find path missing because it does not exist.',
        ],
        [
          'cat missing | ruff check .',
          'Get-Content : Cannot find path missing because it does not exist.',
        ],
      ] as const) {
        const result = interpretCommandResult(command, 1, '', stderr)
        expect(result.isError).toBe(true)
      }
    })

    test('external setup failures before pipelines use default error semantics', () => {
      const result = interpretCommandResult(
        'python missing.py | ruff check .',
        1,
        '',
        "python: can't open file 'missing.py': [Errno 2] No such file or directory",
      )
      expect(result.isError).toBe(true)
    })

    test('silent short-circuited setup before && stays a command error', () => {
      for (const command of [
        '$false && ruff check .',
        'Test-Path missing && ruff check .',
        'Set-Location missing && ruff check .',
      ]) {
        const result = interpretCommandResult(command, 1, '', '')
        expect(result.isError).toBe(true)
      }
    })

    test('merged-output setup failures do not inherit linter semantics', () => {
      for (const [command, stdout] of [
        [
          'Write-Output setup; Set-Location missing && ruff check .',
          'setup\nSet-Location: Cannot find path missing because it does not exist.\n',
        ],
        [
          'Write-Output setup; Get-Content missing | ruff check .',
          'setup\nGet-Content: Cannot find path missing because it does not exist.\n',
        ],
        [
          'badcmd | pytest',
          'badcmd: The term badcmd is not recognized as a name of a cmdlet\n',
        ],
      ] as const) {
        const result = interpretCommandResult(command, 1, stdout, '')
        expect(result.isError).toBe(true)
      }
    })

    test('silent failed pipeline input stays a command error', () => {
      for (const command of [
        '$false | pytest',
        'Test-Path missing | ruff check .',
      ]) {
        const result = interpretCommandResult(command, 1, '', '')
        expect(result.isError).toBe(true)
      }
    })

    test('successful setup before && lets linter diagnostics through', () => {
      const result = interpretCommandResult('Set-Location src && ruff check .', 1, 'F401', '')
      expect(result.isError).toBe(false)
    })

    test('successful setup with empty diagnostic output keeps diagnostic semantics', () => {
      const result = interpretCommandResult('Write-Output hi && ruff check .', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('newline-separated linter command keeps diagnostics semantics', () => {
      const result = interpretCommandResult('Set-Location src\nruff check .', 1, 'F401', '')
      expect(result.isError).toBe(false)
    })

    test('bare ampersand-separated linter command keeps diagnostics semantics', () => {
      const result = interpretCommandResult('Set-Location src & ruff check .', 1, 'F401', '')
      expect(result.isError).toBe(false)
    })

    test('call-operator invocations keep diagnostic semantics', () => {
      const cases = [
        ['& ruff check .', 1],
        ['& ".\\node_modules\\.bin\\eslint.cmd" .', 1],
        ['& ".\\venv\\Scripts\\pytest"', 1],
        ['& npm test', 1],
        ['. ".\\node_modules\\.bin\\eslint.cmd" .', 1],
      ] as const
      for (const [command, exitCode] of cases) {
        const result = interpretCommandResult(command, exitCode, 'diagnostics', '')
        expect(result.isError).toBe(false)
      }
    })

    test('diagnostics after successful setup can mention missing files', () => {
      for (const command of [
        'Set-Location src && pytest',
        'Set-Location src && ruff check .',
        'pytest -k "missing|fixture"',
        'pytest -k "missing&&fixture"',
      ]) {
        const result = interpretCommandResult(
          command,
          1,
          '',
          'FileNotFoundError: File not found: fixture.txt',
        )
        expect(result.isError).toBe(false)
      }
    })

    test('failed pipeline input does not inherit linter semantics', () => {
      for (const [command, stderr] of [
        [
          'Get-Content missing | ruff check .',
          'Get-Content: Cannot find path missing because it does not exist.',
        ],
        [
          'badcmd | pytest',
          'badcmd: The term badcmd is not recognized as a name of a cmdlet',
        ],
        [
          'Write-Output setup; Get-Content missing | ruff check .',
          'Get-Content: Cannot find path missing because it does not exist.',
        ],
      ] as const) {
        const stdout = command.startsWith('Write-Output setup') ? 'setup\n' : ''
        const result = interpretCommandResult(command, 1, stdout, stderr)
        expect(result.isError).toBe(true)
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
