import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../ink.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break

    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break

    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) {
      lastFrame = frame
    }
    cursor = end + SYNC_END.length
  }

  return lastFrame ?? output
}

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  getOutput: () => string
} {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  return {
    stdout,
    stdin,
    getOutput: () => output,
  }
}

afterEach(() => {
  mock.restore()
  delete process.env.NODE_ENV
})

function mockUpdaterDeps(options: {
  latestVersion: string | null
  packageManager: 'homebrew' | 'winget' | 'apk' | 'unknown'
  disabled?: boolean
}): void {
  mock.module('../utils/config.js', () => ({
    isAutoUpdaterDisabled: () => options.disabled ?? false,
  }))

  mock.module('../utils/autoUpdater.js', () => ({
    getLatestVersionFromGcs: async () => options.latestVersion,
    getMaxVersion: async () => undefined,
    shouldSkipVersion: () => false,
  }))

  mock.module('../utils/nativeInstaller/packageManagers.js', () => ({
    getPackageManager: async () => options.packageManager,
  }))

  mock.module('../utils/settings/settings.js', () => ({
    getInitialSettings: () => ({}),
  }))

  mock.module('../utils/debug.js', () => ({
    logForDebugging: () => {},
  }))
}

test('shows copy-pasteable homebrew command when update is available', async () => {
  process.env.NODE_ENV = 'production'
  mockUpdaterDeps({ latestVersion: '0.1.9', packageManager: 'homebrew' })

  const { stdout, stdin, getOutput } = createTestStreams()
  const results: unknown[] = []
  const { PackageManagerAutoUpdater: Component } = await import(
    './PackageManagerAutoUpdater.js'
  )
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <Component
      verbose={false}
      isUpdating={false}
      onChangeIsUpdating={() => {}}
      autoUpdaterResult={null}
      showSuccessMessage={false}
      onAutoUpdaterResult={result => {
        results.push(result)
      }}
    />,
  )

  await Bun.sleep(50)
  const output = stripAnsi(extractLastFrame(getOutput()))

  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(10)

  expect(output).toContain('Update available')
  expect(output).toContain('brew upgrade --cask openclaude')
  expect(results).toHaveLength(1)
  expect(results[0]).toMatchObject({
    status: 'update_available',
    actionLabel: 'brew upgrade --cask openclaude',
  })
})

test('reports up_to_date after previously having an update', async () => {
  process.env.NODE_ENV = 'production'
  mockUpdaterDeps({ latestVersion: '0.1.8', packageManager: 'winget' })

  const results: unknown[] = []
  const { PackageManagerAutoUpdater: Component } = await import(
    './PackageManagerAutoUpdater.js'
  )
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <Component
      verbose={false}
      isUpdating={false}
      onChangeIsUpdating={() => {}}
      autoUpdaterResult={{
        status: 'update_available',
        version: '0.1.9',
        currentVersion: '0.1.8',
      }}
      showSuccessMessage={false}
      onAutoUpdaterResult={result => {
        results.push(result)
      }}
    />,
  )

  await Bun.sleep(50)

  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(10)

  expect(results).toContainEqual(
    expect.objectContaining({
      status: 'up_to_date',
      version: '0.1.8',
      currentVersion: '0.1.8',
    }),
  )
})
