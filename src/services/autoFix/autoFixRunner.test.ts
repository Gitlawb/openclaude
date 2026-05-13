import { describe, expect, test } from 'bun:test'
import {
  runAutoFixCheck,
  type AutoFixResult,
  type AutoFixCheckOptions,
} from './autoFixRunner.js'

const TEST_CWD = process.cwd()

describe('runAutoFixCheck', () => {
  test('returns success when lint command exits 0', async () => {
    const result = await runAutoFixCheck({
      lint: 'echo "all clean"',
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(false)
    expect(result.lintOutput).toContain('all clean')
    expect(result.testOutput).toBeUndefined()
  })

  test('returns errors when lint command exits non-zero', async () => {
    const result = await runAutoFixCheck({
      lint: 'echo "error: unused var" && exit 1',
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(true)
    expect(result.lintOutput).toContain('unused var')
    expect(result.lintExitCode).toBe(1)
  })

  test('returns errors when test command exits non-zero', async () => {
    const result = await runAutoFixCheck({
      test: 'echo "FAIL test_foo" && exit 1',
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(true)
    expect(result.testOutput).toContain('FAIL test_foo')
    expect(result.testExitCode).toBe(1)
  })

  test('runs both lint and test commands', async () => {
    const result = await runAutoFixCheck({
      lint: 'echo "lint ok"',
      test: 'echo "test ok"',
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(false)
    expect(result.lintOutput).toContain('lint ok')
    expect(result.testOutput).toContain('test ok')
  })

  test('skips test if lint fails', async () => {
    const result = await runAutoFixCheck({
      lint: 'echo "lint error" && exit 1',
      test: 'echo "should not run"',
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(true)
    expect(result.lintOutput).toContain('lint error')
    expect(result.testOutput).toBeUndefined()
  })

  test('handles timeout gracefully', async () => {
    const result = await runAutoFixCheck({
      lint: 'node -e "setTimeout(() => {}, 10000)"',
      timeout: 100,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(true)
    expect(result.timedOut).toBe(true)
  })

  test('returns success with no commands configured', async () => {
    const result = await runAutoFixCheck({
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(false)
  })

  test('formats error summary for AI consumption', async () => {
    const result = await runAutoFixCheck({
      lint: 'echo "src/foo.ts:10:5 error no-unused-vars" && exit 1',
      timeout: 5000,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(true)
    const summary = result.errorSummary
    expect(summary).toContain('Lint errors')
    expect(summary).toContain('no-unused-vars')
  })
})
