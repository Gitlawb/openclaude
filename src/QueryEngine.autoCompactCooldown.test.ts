import { test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Cold Windows checkouts can exceed Bun's default 5s while loading QueryEngine.
const FIXTURE_TIMEOUT_MS = 60_000
const TEST_TIMEOUT_MS = FIXTURE_TIMEOUT_MS + 5_000

test('SDK manual compact clears stale auto-compact cooldown tracking', () => {
  const fixture = resolve(
    repoRoot,
    'src/test/fixtures/queryEngineManualCompactCooldown.fixture.ts',
  )
  // Keep QueryEngine module mocks out of Bun's shared test-process cache.
  const result = spawnSync(process.execPath, [fixture], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: FIXTURE_TIMEOUT_MS,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `Fixture exited with status ${result.status ?? 'unknown'}.`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }
}, { timeout: TEST_TIMEOUT_MS })
