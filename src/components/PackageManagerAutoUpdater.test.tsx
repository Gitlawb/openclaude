import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { createRoot } from '../ink.js'
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
      currentVersion: '0.1.8',
      status: 'update_available',
      actionLabel: 'brew upgrade --cask openclaude',
    })
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})

test('reports up_to_date after a previously visible update is no longer available', async () => {
  process.env.NODE_ENV = 'production'

  let latestVersion = '0.2.0'
  mock.module('../utils/autoUpdater.js', () => ({
    getLatestVersionFromGcs: async () => latestVersion,
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

  const onAutoUpdaterResult = mock(() => {})
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  function Harness(): React.ReactNode {
    const [result, setResult] = React.useState<any>(null)

    return (
      <PackageManagerAutoUpdater
        isUpdating={false}
        onChangeIsUpdating={() => {}}
        onAutoUpdaterResult={update => {
          setResult(update)
          onAutoUpdaterResult(update)
        }}
        autoUpdaterResult={result}
        showSuccessMessage={false}
        verbose={false}
      />
    )
  }

  root.render(<Harness />)

  try {
    await waitForCondition(() => onAutoUpdaterResult.mock.calls.length === 1)
    latestVersion = '0.1.8'
    root.render(<Harness />)
    await waitForCondition(() => onAutoUpdaterResult.mock.calls.length === 2)

    expect(onAutoUpdaterResult.mock.calls[1]?.[0]).toEqual({
      version: '0.1.8',
      currentVersion: '0.1.8',
      status: 'up_to_date',
    })
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
    await Bun.sleep(0)
  }
})
