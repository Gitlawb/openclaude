import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('graceful shutdown drains the interruption trace before process exit', () => {
  const fixture = resolve(
    import.meta.dirname,
    '../test/fixtures/gracefulShutdownTrace.fixture.ts',
  )
  const result = spawnSync(process.execPath, [fixture], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  if (result.error) throw result.error
  expect(result.status).toBe(0)
  const resultLine = result.stdout
    .split('\n')
    .find(line => line.startsWith('TRACE_SHUTDOWN_RESULT '))
  expect(resultLine).toBeDefined()
  const payload = JSON.parse(resultLine!.slice('TRACE_SHUTDOWN_RESULT '.length)) as {
    aborted: boolean
    writeSettled: boolean
    exitObservedSettledWrite: boolean
  }
  expect(payload).toEqual({
    aborted: true,
    writeSettled: true,
    exitObservedSettledWrite: true,
  })
}, 20_000)
