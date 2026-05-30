import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { interpretCommandResult } from './commandSemantics.js'

// =============================================================================
// End-to-end: run real tools, feed their REAL exit codes to
// interpretCommandResult, and assert the error/non-error classification.
//
// Unlike the unit tests (which hardcode exit codes), these spawn the actual
// binary so the exit-code assumptions are validated against real behavior.
// Each suite is skipped when its binary is unavailable.
// =============================================================================

const TSC_BIN = join(
  import.meta.dir,
  '../../../node_modules/.bin/tsc',
)

function hasBinary(cmd: string, args: string[]): boolean {
  try {
    const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 60_000 })
    return r.error === undefined && r.status !== null
  } catch {
    return false
  }
}

describe('e2e: tsc real exit codes', () => {
  const tscAvailable = hasBinary(TSC_BIN, ['--version'])
  let dir: string

  beforeAll(() => {
    if (tscAvailable) dir = mkdtempSync(join(tmpdir(), 'semantics-tsc-'))
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test.if(tscAvailable)(
    'clean file → exit 0, not an error',
    () => {
      const f = join(dir, 'good.ts')
      writeFileSync(f, 'const x: number = 1\nexport {}\n')
      const r = spawnSync(TSC_BIN, ['--noEmit', f], { encoding: 'utf8' })
      const cmd = `tsc --noEmit ${f}`
      const result = interpretCommandResult(cmd, r.status ?? -1, r.stdout, r.stderr)
      expect(r.status).toBe(0)
      expect(result.isError).toBe(false)
    },
    60_000,
  )

  test.if(tscAvailable)(
    'type error → exit 2, classified as non-error (read diagnostics)',
    () => {
      const f = join(dir, 'bad.ts')
      writeFileSync(f, 'const x: number = "nope"\nexport {}\n')
      const r = spawnSync(TSC_BIN, ['--noEmit', f], { encoding: 'utf8' })
      const cmd = `tsc --noEmit ${f}`
      const result = interpretCommandResult(cmd, r.status ?? -1, r.stdout, r.stderr)
      // tsc reports type diagnostics with exit code 2 (verified TS 5.9)
      expect(r.status).toBe(2)
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Type errors found')
    },
    60_000,
  )

  test.if(tscAvailable)(
    'unknown CLI flag → exit 1, classified as a real error',
    () => {
      const r = spawnSync(TSC_BIN, ['--definitelyNotAFlag'], { encoding: 'utf8' })
      const result = interpretCommandResult(
        'tsc --definitelyNotAFlag',
        r.status ?? -1,
        r.stdout,
        r.stderr,
      )
      expect(r.status).toBe(1)
      expect(result.isError).toBe(true)
    },
    60_000,
  )
})

describe('e2e: ruff (real exit codes, validates uvx-prefix unwrapping)', () => {
  // Gate on a locally-installed ruff binary. Using `uvx ruff --version` as
  // a probe would trigger a uvx package-index resolution / network fetch on
  // machines that don't have ruff cached, making the normal test suite depend
  // on external network state. We run ruff directly but pass the uvx-prefixed
  // command string to interpretCommandResult to exercise the runner-unwrapping
  // logic without side-effects.
  const ruffAvailable = hasBinary('ruff', ['--version'])
  let dir: string

  beforeAll(() => {
    if (ruffAvailable) dir = mkdtempSync(join(tmpdir(), 'semantics-ruff-'))
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test.if(ruffAvailable)(
    'clean file → exit 0, not an error',
    () => {
      const f = join(dir, 'clean.py')
      writeFileSync(f, 'x = 1\n')
      const r = spawnSync('ruff', ['check', f], { encoding: 'utf8' })
      const result = interpretCommandResult(
        `uvx ruff check ${f}`,
        r.status ?? -1,
        r.stdout,
        r.stderr,
      )
      expect(r.status).toBe(0)
      expect(result.isError).toBe(false)
    },
    60_000,
  )

  test.if(ruffAvailable)(
    'violations → exit 1, classified as non-error (read findings)',
    () => {
      const f = join(dir, 'lint.py')
      // unused import + bare statement → guaranteed violations
      writeFileSync(f, 'import os\nx=1\n')
      const r = spawnSync('ruff', ['check', f], { encoding: 'utf8' })
      const result = interpretCommandResult(
        `uvx ruff check ${f}`,
        r.status ?? -1,
        r.stdout,
        r.stderr,
      )
      // violations (exit 1) must NOT look like a crash,
      // and the runner prefix (uvx) must resolve to ruff.
      expect(r.status).toBe(1)
      expect(result.isError).toBe(false)
    },
    60_000,
  )

  test.if(ruffAvailable)(
    'unknown CLI flag → exit 2, classified as a real error',
    () => {
      const r = spawnSync('ruff', ['--definitelyNotAFlag'], { encoding: 'utf8' })
      const result = interpretCommandResult(
        'uvx ruff --definitelyNotAFlag',
        r.status ?? -1,
        r.stdout,
        r.stderr,
      )
      expect(r.status).toBe(2)
      expect(result.isError).toBe(true)
    },
    60_000,
  )
})
