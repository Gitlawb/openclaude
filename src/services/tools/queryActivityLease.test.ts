import { afterEach, describe, expect, test } from 'vitest'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { createToolQueryLeaseInput } from './queryActivityLease.js'

const ORIGINAL_BASH_DEFAULT_TIMEOUT_MS = process.env.BASH_DEFAULT_TIMEOUT_MS
const ORIGINAL_BASH_MAX_TIMEOUT_MS = process.env.BASH_MAX_TIMEOUT_MS

function setShellTimeoutEnv(defaultTimeoutMs = '180000', maxTimeoutMs = '600000') {
  process.env.BASH_DEFAULT_TIMEOUT_MS = defaultTimeoutMs
  process.env.BASH_MAX_TIMEOUT_MS = maxTimeoutMs
}

describe('query activity leases for tools', () => {
  afterEach(() => {
    if (ORIGINAL_BASH_DEFAULT_TIMEOUT_MS === undefined) {
      delete process.env.BASH_DEFAULT_TIMEOUT_MS
    } else {
      process.env.BASH_DEFAULT_TIMEOUT_MS = ORIGINAL_BASH_DEFAULT_TIMEOUT_MS
    }

    if (ORIGINAL_BASH_MAX_TIMEOUT_MS === undefined) {
      delete process.env.BASH_MAX_TIMEOUT_MS
    } else {
      process.env.BASH_MAX_TIMEOUT_MS = ORIGINAL_BASH_MAX_TIMEOUT_MS
    }
  })

  test('foreground Bash with explicit timeout gets a bounded lease', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_1', {
      command: 'bun test',
      timeout: 600_000,
      run_in_background: false,
    })

    expect(leaseInput).toEqual({
      owner: 'bash',
      id: 'toolu_1',
      timeoutMs: 600_000,
      description: BASH_TOOL_NAME,
    })
  })

  test('foreground PowerShell with explicit timeout gets a bounded lease', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(POWERSHELL_TOOL_NAME, 'toolu_ps', {
      command: 'npm test',
      timeout: 120_000,
    })

    expect(leaseInput).toEqual({
      owner: 'powershell',
      id: 'toolu_ps',
      timeoutMs: 120_000,
      description: POWERSHELL_TOOL_NAME,
    })
  })

  test('foreground Bash without explicit timeout uses the safe default timeout', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_2', {
      command: 'bun run build',
    })

    expect(leaseInput).toEqual({
      owner: 'bash',
      id: 'toolu_2',
      timeoutMs: 180_000,
      description: BASH_TOOL_NAME,
    })
  })

  test('foreground Bash explicit timeout is clamped to the configured maximum', () => {
    setShellTimeoutEnv('120000', '300000')

    const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_clamped', {
      command: 'bun run slow-check',
      timeout: 900_000,
    })

    expect(leaseInput).toEqual({
      owner: 'bash',
      id: 'toolu_clamped',
      timeoutMs: 300_000,
      description: BASH_TOOL_NAME,
    })
  })

  test('foreground Bash invalid timeout values fall back to the safe default', () => {
    setShellTimeoutEnv('150000', '600000')

    for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '60000']) {
      const leaseInput = createToolQueryLeaseInput(BASH_TOOL_NAME, `toolu_${String(timeout)}`, {
        command: 'bun test',
        timeout,
      })

      expect(leaseInput).toEqual({
        owner: 'bash',
        id: `toolu_${String(timeout)}`,
        timeoutMs: 150_000,
        description: BASH_TOOL_NAME,
      })
    }
  })

  test('explicit background shell commands skip foreground query leases', () => {
    setShellTimeoutEnv()

    const leaseInput = createToolQueryLeaseInput(POWERSHELL_TOOL_NAME, 'toolu_3', {
      command: 'Start-Sleep -Seconds 60',
      run_in_background: true,
    })

    expect(leaseInput).toBeNull()
  })

  test('non-shell tools skip query leases', () => {
    const leaseInput = createToolQueryLeaseInput('Read', 'toolu_4', {
      file_path: 'README.md',
    })

    expect(leaseInput).toBeNull()
  })

  test('non-record tool inputs skip query leases', () => {
    expect(createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_array', [])).toBeNull()
    expect(createToolQueryLeaseInput(BASH_TOOL_NAME, 'toolu_null', null)).toBeNull()
  })
})
