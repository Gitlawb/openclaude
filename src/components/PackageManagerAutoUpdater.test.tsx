import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { createRoot } from '../ink.js'
import type { AutoUpdaterResult } from '../utils/autoUpdater.js'
import { PackageManagerAutoUpdater } from './PackageManagerAutoUpdater.js'

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
} {
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

  return { stdout, stdin }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for PackageManagerAutoUpdater test condition')
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  mock.restore()
})

test('reports update_available with the resolved package manager command', async () => {
  process.env.NODE_ENV = 'production'

  mock.module('../utils/autoUpdater.js', () => ({
    getLatestVersionFromGcs: async () => '0.2.0',
    getMaxVersion: async () => null,
    shouldSkipVersion: () => false,
  }))
  mock.module('../utils/config.js', () => ({
    isAutoUpdaterDisabled: () => false,
  }))
  mock.module('../utils/nativeInstaller/packageManagers.js', () => ({
    getPackageManager: async () => 'homebrew',
  }))
  mock.module('../utils/settings/settings.js', () => ({
    getInitialSettings: () => ({ autoUpdatesChannel: 'latest' }),
  }))
  mock.module('../utils/debug.js', () => ({
    logForDebugging: () => {},
  }))

  const onAutoUpdaterResult = mock(() => {})
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <PackageManagerAutoUpdater
      isUpdating={false}
      onChangeIsUpdating={() => {}}
      onAutoUpdaterResult={onAutoUpdaterResult}
      autoUpdaterResult={null}
      showSuccessMessage={false}
      verbose={false}
    />,
  )

  try {
    await waitForCondition(() => onAutoUpdaterResult.mock.calls.length > 0)

    expect(onAutoUpdaterResult).toHaveBeenCalledWith({
      version: '0.2.0',
      currentVersion: expect.any(String),
      status: 'update_available',
      actionLabel: 'brew upgrade (see Homebrew for the OpenClaude formula/cask name)',
    })
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})

test('renders the resolved update version from autoUpdaterResult when available', async () => {
  process.env.NODE_ENV = 'production'

  mock.module('../utils/autoUpdater.js', () => ({
    getLatestVersionFromGcs: async () => '0.2.0',
    getMaxVersion: async () => null,
    shouldSkipVersion: () => false,
  }))
  mock.module('../utils/config.js', () => ({
    isAutoUpdaterDisabled: () => false,
  }))
  mock.module('../utils/nativeInstaller/packageManagers.js', () => ({
    getPackageManager: async () => 'unknown',
  }))
  mock.module('../utils/settings/settings.js', () => ({
    getInitialSettings: () => ({ autoUpdatesChannel: 'latest' }),
  }))
  mock.module('../utils/debug.js', () => ({
    logForDebugging: () => {},
  }))
  mock.module('usehooks-ts', () => ({
    useInterval: () => {},
  }))

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

  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  const autoUpdaterResult: AutoUpdaterResult = {
    version: '0.2.0',
    currentVersion: '0.1.7',
    status: 'update_available',
    actionLabel: 'Use your package manager to update OpenClaude',
  }

  root.render(
    <PackageManagerAutoUpdater
      isUpdating={false}
      onChangeIsUpdating={() => {}}
      onAutoUpdaterResult={() => {}}
      autoUpdaterResult={autoUpdaterResult}
      showSuccessMessage={false}
      verbose={false}
    />,
  )

  try {
    await waitForCondition(() => output.includes('0.2.0'))
    expect(output).toContain('0.2.0')
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})
