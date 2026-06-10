import { PassThrough } from 'node:stream'

import { afterEach, expect, test } from 'bun:test'
import React from 'react'

import { createRoot, type Root } from '../../ink.js'
import { showDangerousModePromptIfNeeded } from './dangerousModePromptFlow.js'

let hasBypassAcceptance = false
let hasFullAccessAcceptance = false
const seenModes: string[] = []

function TestBypassPermissionsModeDialog({
  mode = 'bypassPermissions',
  onAccept,
}: {
  mode?: 'bypassPermissions' | 'fullAccess'
  onAccept: () => void
}) {
  React.useEffect(() => {
    seenModes.push(mode)
    onAccept()
  }, [mode, onAccept])

  return null
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

function testShowSetupDialog<T = void>(
  root: Root,
  renderer: (done: (result: T) => void) => React.ReactNode,
): Promise<T> {
  return new Promise<T>(resolve => {
    root.render(renderer(resolve))
  })
}

afterEach(() => {
  hasBypassAcceptance = false
  hasFullAccessAcceptance = false
  seenModes.length = 0
})

test('shows the fullAccess dangerous-mode dialog through the rendered startup flow', async () => {
  const { root, stdout, stdin } = await createTestRoot()

  try {
    const shown = await showDangerousModePromptIfNeeded(
      root,
      'fullAccess',
      false,
      testShowSetupDialog,
      {
        DialogComponent: TestBypassPermissionsModeDialog,
        getPromptState: ({ permissionMode }) => ({
          mode: permissionMode === 'fullAccess' ? 'fullAccess' : null,
          shouldShow: true,
        }),
        persistAcceptance: () => {},
      },
    )

    expect(shown).toBe(true)
    expect(seenModes).toEqual(['fullAccess'])
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})

test('skips rendering the dialog when fullAccess consent was already accepted', async () => {
  hasFullAccessAcceptance = true
  const { root, stdout, stdin } = await createTestRoot()

  try {
    const shown = await showDangerousModePromptIfNeeded(
      root,
      'fullAccess',
      false,
      testShowSetupDialog,
      {
        DialogComponent: TestBypassPermissionsModeDialog,
        getPromptState: ({ permissionMode }) => ({
          mode: permissionMode === 'fullAccess' ? 'fullAccess' : null,
          shouldShow:
            permissionMode === 'fullAccess'
              ? !hasFullAccessAcceptance
              : !hasBypassAcceptance,
        }),
        persistAcceptance: () => {},
      },
    )

    expect(shown).toBe(false)
    expect(seenModes).toEqual([])
  } finally {
    root.unmount()
    stdin.end()
    stdout.end()
  }
})
