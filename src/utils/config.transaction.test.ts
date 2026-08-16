import { expect, test } from 'bun:test'
import { join } from 'node:path'

const RELEASE_FAILURE_FIXTURE = join(
  import.meta.dir,
  '../test/fixtures/globalConfigReleaseFailure.fixture.ts',
)

test('a committed global config write is not replayed when lock release fails', async () => {
  const processResult = Bun.spawn(
    [process.execPath, RELEASE_FAILURE_FIXTURE],
    {
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ])

  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(JSON.parse(stdout)).toEqual({
    persisted: true,
    updaterCalls: 1,
    onDiskValue: 1,
    cachedValue: 1,
  })
})
