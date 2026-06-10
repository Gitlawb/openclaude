/**
 * Typecheck ratchet — keeps `tsc --noEmit` error debt monotonically shrinking.
 *
 * The repo carries pre-existing TypeScript errors (issue #473 tracks the
 * burn-down). Until the count reaches zero this script, not `tsc`'s exit
 * code, is the CI gate:
 *
 *   - error count >  baseline → FAIL, listing the files that regressed
 *   - error count == baseline → pass
 *   - error count <  baseline → pass, with a reminder to lower the baseline
 *     (run with --update to write it) so the gain is locked in
 *
 * Once the baseline hits zero, replace the ratchet step in CI with a plain
 * `bun run typecheck`.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(import.meta.dir, '..')
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'typecheck-baseline.json')

const update = process.argv.includes('--update')

const baseline: { errors: number; byFile: Record<string, number> } =
  JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))

const result = Bun.spawnSync(['bunx', 'tsc', '--noEmit'], {
  cwd: REPO_ROOT,
  stdout: 'pipe',
  stderr: 'pipe',
})
const output =
  result.stdout.toString('utf-8') + result.stderr.toString('utf-8')
const errorLines = output
  .split('\n')
  .filter(line => /error TS\d+:/.test(line))
const count = errorLines.length

// tsc exits non-zero on errors; only a crash with zero parseable errors is
// a tooling failure worth surfacing as-is.
if (result.exitCode !== 0 && count === 0) {
  console.error('tsc failed without reporting parseable errors:')
  console.error(output.slice(0, 4000))
  process.exit(1)
}

const byFile = new Map<string, number>()
for (const line of errorLines) {
  const file = line.split('(')[0]
  byFile.set(file, (byFile.get(file) ?? 0) + 1)
}

function writeBaseline(): void {
  const sorted = Object.fromEntries(
    [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  )
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ errors: count, byFile: sorted }, null, 2) + '\n',
  )
}

if (count > baseline.errors) {
  console.error(
    `Typecheck ratchet FAILED: ${count} errors > baseline ${baseline.errors} (+${count - baseline.errors}).`,
  )
  console.error('Files with more errors than the committed baseline:')
  for (const [file, n] of [...byFile.entries()].sort()) {
    const before = baseline.byFile[file] ?? 0
    if (n > before) console.error(`  ${file}: ${before} → ${n}`)
  }
  console.error(
    'Fix the new errors (do not raise the baseline). Full log: bun run typecheck',
  )
  process.exit(1)
}

if (count < baseline.errors) {
  if (update) {
    writeBaseline()
    console.log(
      `Typecheck ratchet: baseline lowered ${baseline.errors} → ${count}. Commit scripts/typecheck-baseline.json.`,
    )
  } else {
    console.log(
      `Typecheck ratchet: PASS — ${count} errors, ${baseline.errors - count} below baseline ${baseline.errors}.`,
    )
    console.log(
      'Lock in the gain: run `bun run typecheck:ratchet -- --update` and commit the baseline.',
    )
  }
  process.exit(0)
}

console.log(`Typecheck ratchet: PASS — ${count} errors (== baseline).`)
