import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { createRoot, type Root } from '../../ink.js'

let shouldShowPrompt = true
const persistedModes: Array<'bypassPermissions' | 'fullAccess'> = []
let continuationCount = 0
let resolvePersisted: (() => void) | null = null
let resolveContinued: (() => void) | null = null

async function importFreshUseDangerousModeConfirmation() {
  mock.module('../../utils/permissions/dangerousModePromptRuntime.js', () => ({
    getStartupDangerousPermissionPromptState: ({
      permissionMode,
    }: {
      permissionMode: 'bypassPermissions' | 'fullAccess'
    }) => ({
      mode: permissionMode,
      shouldShow: shouldShowPrompt,
    }),
    persistDangerousModeAcceptance: (
      mode: 'bypassPermissions' | 'fullAccess',
    ) => {
      persistedModes.push(mode)
      resolvePersisted?.()
    },
  }))

  mock.module('../BypassPermissionsModeDialog.js', () => ({
    BypassPermissionsModeDialog({
      onAccept,
    }: {
      onAccept: () => void
    }) {
      React.useEffect(() => {
        onAccept()
      }, [onAccept])

      return null
    },
  }))

  return import(`./useDangerousModeConfirmation.js?ts=${Date.now()}-${Math.random()}`)
}

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

async function createTestRoot(): Promise<{
  root: Root
  stdout: PassThrough
  stdin: PassThrough
}> {
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  return { root, stdout, stdin }
}

function Harness({
  direct = false,
  mode,
  useDangerousModeConfirmation,
}: {
  direct?: boolean
  mode: 'bypassPermissions' | 'fullAccess'
  useDangerousModeConfirmation: typeof import('./useDangerousModeConfirmation.js').useDangerousModeConfirmation
}) {
  const {
    confirmDangerousMode,
    dangerousModeDialog,
    requestDangerousModeConfirmation,
  } =
    useDangerousModeConfirmation()

  React.useEffect(() => {
    const onConfirm = () => {
      continuationCount += 1
      resolveContinued?.()
    }

    if (direct) {
      requestDangerousModeConfirmation(mode, onConfirm)
      return
    }

    confirmDangerousMode(mode, onConfirm)
  }, [confirmDangerousMode, direct, mode, requestDangerousModeConfirmation])

  return dangerousModeDialog
}

afterEach(() => {
  mock.restore()
  shouldShowPrompt = true
  persistedModes.length = 0
  continuationCount = 0
  resolvePersisted = null
  resolveContinued = null
})

test('persists acceptance before continuing after a dangerous-mode confirmation', async () => {
  const { root, stdout, stdin } = await createTestRoot()
  const { useDangerousModeConfirmation } =
    await importFreshUseDangerousModeConfirmation()
  const persisted = new Promise<void>(resolve => {
    resolvePersisted = resolve
  })
  const continued = new Promise<void>(resolve => {
    resolveContinued = resolve
  })

  try {
    root.render(
      <Harness
        mode="fullAccess"
        useDangerousModeConfirmation={useDangerousModeConfirmation}
      />,
    )
    await Promise.all([persisted, continued])

    expect(persistedModes).toEqual(['fullAccess'])
    expect(continuationCount).toBe(1)
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('continues immediately when no confirmation prompt is required', async () => {
  shouldShowPrompt = false
  const { root, stdout, stdin } = await createTestRoot()
  const { useDangerousModeConfirmation } =
    await importFreshUseDangerousModeConfirmation()
  const continued = new Promise<void>(resolve => {
    resolveContinued = resolve
  })

  try {
    root.render(
      <Harness
        mode="bypassPermissions"
        useDangerousModeConfirmation={useDangerousModeConfirmation}
      />,
    )
    await continued

    expect(persistedModes).toEqual([])
    expect(continuationCount).toBe(1)
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('can render a resolved dangerous-mode confirmation without re-checking prompt state', async () => {
  shouldShowPrompt = false
  const { root, stdout, stdin } = await createTestRoot()
  const { useDangerousModeConfirmation } =
    await importFreshUseDangerousModeConfirmation()
  const persisted = new Promise<void>(resolve => {
    resolvePersisted = resolve
  })
  const continued = new Promise<void>(resolve => {
    resolveContinued = resolve
  })

  try {
    root.render(
      <Harness
        direct
        mode="fullAccess"
        useDangerousModeConfirmation={useDangerousModeConfirmation}
      />,
    )
    await Promise.all([persisted, continued])

    expect(persistedModes).toEqual(['fullAccess'])
    expect(continuationCount).toBe(1)
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})
