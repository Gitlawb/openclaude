import { describe, expect, test } from 'bun:test'
import { getAutoFixConfig } from './autoFixConfig.js'
import { shouldRunAutoFix, buildAutoFixContext } from './autoFixHook.js'
import { runAutoFixCheck } from './autoFixRunner.js'

const TEST_CWD = process.cwd()

describe('autoFix end-to-end flow', () => {
  test('full flow: config → shouldRun → check → context', async () => {
    const config = getAutoFixConfig({
      enabled: true,
      lint: 'echo "error: unused" && exit 1',
      maxRetries: 2,
      timeout: 5000,
    })
    expect(config).not.toBeNull()
    expect(shouldRunAutoFix('file_edit', config)).toBe(true)

    const result = await runAutoFixCheck({
      lint: config!.lint,
      test: config!.test,
      timeout: config!.timeout,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(true)

    const context = buildAutoFixContext(result)
    expect(context).not.toBeNull()
    expect(context).toContain('AUTO-FIX')
    expect(context).toContain('unused')
  })

  test('full flow: no errors = no context', async () => {
    const config = getAutoFixConfig({
      enabled: true,
      lint: 'echo "all clean"',
      timeout: 5000,
    })
    const result = await runAutoFixCheck({
      lint: config!.lint,
      timeout: config!.timeout,

      cwd: TEST_CWD,
    })
    expect(result.hasErrors).toBe(false)
    const context = buildAutoFixContext(result)
    expect(context).toBeNull()
  })
})
