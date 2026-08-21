import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkInstalledChromeEntrypoint,
  getTarballPayloadProblems,
  resolvePreviousPublishedVersion,
  runCommand,
} from './verify-clean-install.js'

const scratchDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

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

describe('clean-install verifier seams', () => {
  test('keeps Windows command and space-containing arguments as separate argv values', () => {
    const calls: Array<{ command: string; args: string[]; options: object }> = []
    const command = 'C:\\install prefix\\openclaude.cmd'
    const args = [
      'install',
      '--prefix=C:\\install prefix',
      '--cache=C:\\npm cache',
    ]

    const result = runCommand(
      command,
      args,
      { env: {}, timeout: 1_000 },
      (receivedCommand, receivedArgs, options) => {
        calls.push({
          command: receivedCommand,
          args: receivedArgs,
          options,
        })
        return { exitCode: 0, stdout: 'ok\n', stderr: '' }
      },
    )

    expect(calls).toEqual([
      {
        command,
        args,
        options: {
          env: {},
          timeout: 1_000,
          reject: false,
          stripFinalNewline: false,
        },
      },
    ])
    expect(result).toEqual({ status: 0, stdout: 'ok\n', stderr: '' })
  })

  test('reports missing required and present forbidden tar entries independently', () => {
    expect(getTarballPayloadProblems(new Set(['package/dist/cli.js']))).toEqual([
      expect.stringContaining('tarball is missing declared payload'),
      'tarball contains obsolete CLI payload: package/dist/cli.js',
    ])
  })

  test('records missing installed Chrome artifacts without throwing', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'openclaude verifier artifacts '))
    scratchDirs.push(scratch)
    const packageRoot = join(
      scratch,
      ...(process.platform === 'win32'
        ? ['node_modules']
        : ['lib', 'node_modules']),
      '@gitlawb',
      'openclaude',
    )
    const manifestPath = join(packageRoot, 'package.json')
    const launcherPath = join(packageRoot, 'bin', 'openclaude')
    const failures: string[] = []
    const passes: string[] = []
    const reporter = {
      fail: (problem: string) => failures.push(problem),
      pass: (what: string) => passes.push(what),
    }

    checkInstalledChromeEntrypoint('test', scratch, true, reporter)
    expect(failures.splice(0)).toEqual([
      `installed manifest missing at ${manifestPath}`,
    ])

    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(
      manifestPath,
      JSON.stringify({ bin: { openclaude: 'bin/openclaude' } }),
    )
    checkInstalledChromeEntrypoint('test', scratch, true, reporter)
    expect(failures.splice(0)).toEqual([
      `installed OpenClaude launcher missing at ${launcherPath}`,
    ])

    mkdirSync(join(packageRoot, 'bin'), { recursive: true })
    writeFileSync(launcherPath, '#!/usr/bin/env node\n')
    checkInstalledChromeEntrypoint('test', scratch, true, reporter)
    expect(failures.splice(0)).toEqual([
      `installed CLI bundle missing at ${join(packageRoot, 'dist', 'cli.mjs')}`,
    ])
    expect(passes).toEqual([
      'Chrome child launches resolve the installed bin/openclaude',
    ])
  })
})
