/**
 * Regression tests for issue #402 — NODE_OPTIONS heap cap
 * Closes: Gitlawb/openclaude#402 — JavaScript heap OOM during large tasks
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

describe('cli.tsx — NODE_OPTIONS --max-old-space-size (issue #402)', () => {
  const originalNodeOptions = process.env.NODE_OPTIONS

  beforeEach(() => {
    delete process.env.NODE_OPTIONS
  })

  afterEach(() => {
    if (originalNodeOptions !== undefined) {
      process.env.NODE_OPTIONS = originalNodeOptions
    } else {
      delete process.env.NODE_OPTIONS
    }
  })

  it('sets --max-old-space-size=8192 when NODE_OPTIONS is not set', () => {
    // Guard predicate: fires when the flag is absent
    const shouldSetHeapCap = !process.env.NODE_OPTIONS?.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(true)
  })

  it('does not override existing --max-old-space-size=4096', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096 --experimental-vm-modules'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toContain('4096')
  })

  it('does not override existing --max-old-space-size=8192', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=8192'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=8192')
  })

  it('appends --max-old-space-size when NODE_OPTIONS has other flags', () => {
    process.env.NODE_OPTIONS = '--inspect=9229'

    const result = `${process.env.NODE_OPTIONS} --max-old-space-size=8192`
    expect(result).toBe('--inspect=9229 --max-old-space-size=8192')
  })
})

describe('useMemoryUsage.ts — threshold constants (issue #402)', () => {
  it('HIGH_MEMORY_THRESHOLD documented as 1.5 GB', async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../hooks/useMemoryUsage.ts`,
    ).text()

    expect(src).toContain('HIGH_MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024')
  })

  it('CRITICAL_MEMORY_THRESHOLD documented as 2.5 GB', async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../hooks/useMemoryUsage.ts`,
    ).text()

    expect(src).toContain('CRITICAL_MEMORY_THRESHOLD = 2.5 * 1024 * 1024 * 1024')
  })
})

describe('cli.tsx — --provider startup ordering', () => {
  it('remembers --provider so settings.env reloads cannot clobber it', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()

    const earlyProviderApplyIndex = src.indexOf('applyProviderFlagFromArgs(args')
    const rememberOptionIndex = src.indexOf(
      'rememberForSettingsEnv: true',
      earlyProviderApplyIndex,
    )
    const settingsEnvApplyIndex = src.indexOf(
      'applySafeConfigEnvironmentVariables()',
    )

    expect(earlyProviderApplyIndex).toBeGreaterThanOrEqual(0)
    expect(rememberOptionIndex).toBeGreaterThan(earlyProviderApplyIndex)
    expect(settingsEnvApplyIndex).toBeGreaterThan(earlyProviderApplyIndex)
  })

  it('reapplies remembered --provider after every managed settings env merge', async () => {
    const src = await Bun.file(`${import.meta.dir}/../utils/managedEnv.ts`).text()
    const safeApplyIndex = src.indexOf('export function applySafeConfigEnvironmentVariables')
    const configApplyIndex = src.indexOf('export function applyConfigEnvironmentVariables')
    const safeReapplyIndex = src.indexOf(
      'reapplyRememberedProviderFlag()',
      safeApplyIndex,
    )
    const configReapplyIndex = src.indexOf(
      'reapplyRememberedProviderFlag()',
      configApplyIndex,
    )

    expect(safeReapplyIndex).toBeGreaterThan(safeApplyIndex)
    expect(safeReapplyIndex).toBeLessThan(configApplyIndex)
    expect(configReapplyIndex).toBeGreaterThan(configApplyIndex)
  })
})
