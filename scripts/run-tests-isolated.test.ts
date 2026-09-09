import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listTestFiles, selectTestFiles, runTestFile, testEnvironment } from './run-tests-isolated.js'

test('discovers tracked and untracked suites, including .mjs, without accepting ignored fixtures', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'runner-discovery-'))
  try {
    expect(Bun.spawnSync(['git', 'init', cwd]).exitCode).toBe(0)
    await writeFile(join(cwd, '.gitignore'), 'ignored/\n')
    await mkdir(join(cwd, 'ignored'))
    for (const file of ['tracked.test.ts', 'new.test.mjs', 'new.test.tsx', 'ignored/fixture.test.ts']) await writeFile(join(cwd, file), '')
    expect(Bun.spawnSync(['git', '-C', cwd, 'add', 'tracked.test.ts']).exitCode).toBe(0)
    expect(listTestFiles(cwd)).toEqual(['new.test.mjs', 'new.test.tsx', 'tracked.test.ts'])
    expect(selectTestFiles(listTestFiles(cwd), ['new.test.mjs'])).toEqual(['new.test.mjs'])
    expect(() => selectTestFiles(listTestFiles(cwd), ['misspelled.test.ts'])).toThrow('No test files')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('a failed assertion fails the suite and configuration cannot leak to another process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runner-failure-'))
  try {
    const file = join(dir, 'failure.test.ts')
    await writeFile(file, `import { test, expect } from 'bun:test'; test('intentional failure', () => { expect(1).toBe(2) })`)
    const result = await runTestFile(file)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('intentional failure')
    expect(testEnvironment(join(dir, 'one')).VERBOO_CONFIG_DIR).not.toBe(testEnvironment(join(dir, 'two')).VERBOO_CONFIG_DIR)
    expect(testEnvironment(dir).ANTHROPIC_API_KEY).toBeUndefined()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a stalled suite is terminated at its deadline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runner-timeout-'))
  const previous = process.env.TEST_FILE_TIMEOUT_MS
  try {
    const file = join(dir, 'stall.test.ts')
    await writeFile(file, `import { test } from 'bun:test'; test('stall', async () => { await new Promise(() => {}); }, 60_000)`)
    process.env.TEST_FILE_TIMEOUT_MS = '500'
    const result = await runTestFile(file)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(124)
    expect(result.durationMs).toBeLessThan(3000)
  } finally {
    if (previous === undefined) delete process.env.TEST_FILE_TIMEOUT_MS
    else process.env.TEST_FILE_TIMEOUT_MS = previous
    await rm(dir, { recursive: true, force: true })
  }
})
