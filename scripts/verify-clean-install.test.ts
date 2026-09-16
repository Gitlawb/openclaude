import { describe, expect, test } from 'bun:test'

import {
  isAllowedInstallOutputLine,
  isAllowedInstallScriptOffender,
  resolvePreviousPublishedVersion,
} from './verify-clean-install.js'

// The retry/skip/infra branches decide whether the upgrade-install scenario
// runs, is skipped, or aborts as an infra failure — regression-covered here
// with injected npm results (the real script wires runView to `npm view` and
// onInfraFailure to process.exit(2)).

const ok = (version: string) => ({ status: 0, stdout: `${version}\n`, stderr: '' })
const infraFail = { status: 1, stdout: '', stderr: 'npm error network ECONNRESET while fetching' }
const notPublished = { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' }

class InfraExit extends Error {
  constructor(readonly combined: string) {
    super('infra exit')
  }
}

function run(results: Array<{ status: number; stdout: string; stderr: string }>, retries = 3) {
  let calls = 0
  const retryAttempts: number[] = []
  const value = resolvePreviousPublishedVersion({
    runView: () => {
      const result = results[calls]
      calls++
      if (!result) throw new Error(`runView called ${calls} times, only ${results.length} results provided`)
      return result
    },
    onRetry: attempt => retryAttempts.push(attempt),
    onInfraFailure: combined => {
      throw new InfraExit(combined)
    },
    retries,
  })
  return { value, calls, retryAttempts }
}

describe('resolvePreviousPublishedVersion', () => {
  test('returns the version on first success without retrying', () => {
    const { value, calls, retryAttempts } = run([ok('0.24.0')])
    expect(value).toBe('0.24.0')
    expect(calls).toBe(1)
    expect(retryAttempts).toEqual([])
  })

  test('transient infra failure retries and then succeeds', () => {
    const { value, calls, retryAttempts } = run([infraFail, infraFail, ok('0.24.0')])
    expect(value).toBe('0.24.0')
    expect(calls).toBe(3)
    expect(retryAttempts).toEqual([1, 2])
  })

  test('clean unavailability (E404) returns null immediately — skip, not infra', () => {
    const { value, calls, retryAttempts } = run([notPublished])
    expect(value).toBeNull()
    expect(calls).toBe(1)
    expect(retryAttempts).toEqual([])
  })

  test('persistent infra failure invokes onInfraFailure after exhausting retries', () => {
    let caught: InfraExit | null = null
    try {
      run([infraFail, infraFail, infraFail])
    } catch (error) {
      caught = error as InfraExit
    }
    expect(caught).toBeInstanceOf(InfraExit)
    expect(caught!.combined).toContain('ECONNRESET')
  })

  test('unparseable success output returns null rather than a bogus version', () => {
    const { value } = run([ok('not-a-version')])
    expect(value).toBeNull()
  })
})

describe('native optional install-script allowlist (#2224)', () => {
  test('allows sharp and its platform binaries, rejects unrelated hooks', () => {
    expect(isAllowedInstallScriptOffender('sharp@0.34.5 (install)')).toBe(true)
    expect(isAllowedInstallScriptOffender('@img/sharp-linux-x64@0.34.5 (install)')).toBe(
      true,
    )
    expect(
      isAllowedInstallScriptOffender('@img/sharp-libvips-linux-x64@1.2.4 (install)'),
    ).toBe(true)
    expect(isAllowedInstallScriptOffender('left-pad@1.0.0 (postinstall)')).toBe(false)
    expect(isAllowedInstallScriptOffender('@sentry/node@10.70.0 (install)')).toBe(false)
  })

  test('allows sharp lifecycle banners and rejects other npm warn lines', () => {
    expect(isAllowedInstallOutputLine('> sharp@0.34.5 install')).toBe(true)
    expect(isAllowedInstallOutputLine('> node install/check.js || npm run build')).toBe(
      true,
    )
    expect(isAllowedInstallOutputLine('sharp: skipping install check: missing')).toBe(
      true,
    )
    expect(isAllowedInstallOutputLine('added 8 packages in 19s')).toBe(true)
    expect(isAllowedInstallOutputLine('npm warn deprecated left-pad@1.0.0')).toBe(false)
  })
})
