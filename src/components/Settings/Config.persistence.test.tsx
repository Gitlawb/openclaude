import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { Text, render } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import {
  AppStateProvider,
  getDefaultAppState,
} from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import type { SettingsJson } from '../../utils/settings/types.js'

type SettingsModule = typeof import('../../utils/settings/settings.js')

let actualSettingsModule: SettingsModule | undefined
let persistError: Error | null = new Error('settings locked')
let updateSettingsForTest = mock(
  (..._args: Parameters<SettingsModule['updateSettingsForSource']>) => ({
    error: persistError,
    written: persistError === null,
  }),
)
let completeOutputStyle: ((style: string | undefined) => void) | undefined

const initialSettings: SettingsJson = {
  outputStyle: 'default',
  spinnerTipsEnabled: true,
}
const emptyMemoryFiles = Promise.resolve([])

async function installMocks(): Promise<void> {
  actualSettingsModule ??= await import(
    `../../utils/settings/settings.ts?configPersistenceActual=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/settings/settings.js', () => ({
    ...actualSettingsModule!,
    getInitialSettings: () => initialSettings,
    getSettingsForSource: () => initialSettings,
    updateSettingsForSource: (
      ...args: Parameters<SettingsModule['updateSettingsForSource']>
    ) => updateSettingsForTest(...args),
  }))
  mock.module('../../utils/claudemd.js', () => ({
    getExternalClaudeMdIncludes: () => [],
    getMemoryFiles: () => emptyMemoryFiles,
    hasExternalClaudeMdIncludes: () => false,
  }))
  mock.module('../OutputStylePicker.js', () => ({
    OutputStylePicker: ({
      onComplete,
    }: {
      onComplete: (style: string | undefined) => void
    }) => {
      completeOutputStyle = onComplete
      return <Text>Test output style picker</Text>
    },
  }))
}

function makeStdio() {
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
  ;(stdout as unknown as { rows: number }).rows = 40
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return {
    stdin,
    stdout,
    getFrame: () => stripAnsi(extractLastFrame(output)),
  }
}

function extractLastFrame(output: string): string {
  const startMarker = '\u001b[?2026h'
  const endMarker = '\u001b[?2026l'
  let lastFrame: string | null = null
  let cursor = 0
  while (cursor < output.length) {
    const start = output.indexOf(startMarker, cursor)
    if (start === -1) break
    const contentStart = start + startMarker.length
    const end = output.indexOf(endMarker, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim()) lastFrame = frame
    cursor = end + endMarker.length
  }
  return lastFrame ?? output
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for Config persistence test condition')
    }
    await Bun.sleep(10)
  }
}

const context = {
  messages: [],
  options: {
    ideInstallationStatus: null,
    mcpClients: [],
    theme: 'dark',
  },
} as unknown as LocalJSXCommandContext

beforeEach(async () => {
  await acquireSharedMutationLock('components/Settings/Config.persistence.test.tsx')
  mock.restore()
  persistError = new Error('settings locked')
  completeOutputStyle = undefined
  updateSettingsForTest = mock(
    (..._args: Parameters<SettingsModule['updateSettingsForSource']>) => ({
      error: persistError,
      written: persistError === null,
    }),
  )
  await installMocks()
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('failed toggle persistence leaves displayed and dirty state unchanged', async () => {
  const { Config } = await import(`./Config.js?toggleFailure=${Date.now()}`)
  const { stdin, stdout, getFrame } = makeStdio()
  const onClose = mock(() => {})
  const instance = await render(
    <AppStateProvider initialState={getDefaultAppState()}>
      <KeybindingSetup>
        <Config
          context={context}
          onClose={onClose}
          setTabsHidden={() => {}}
        />
      </KeybindingSetup>
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => getFrame().includes('Show tips'))
    stdin.write('Show tips')
    await waitForCondition(() => getFrame().includes('⌕ Show tips'))
    stdin.write('\r')
    await waitForCondition(() => !getFrame().includes('Type to filter'))
    stdin.write(' ')
    await waitForCondition(() => updateSettingsForTest.mock.calls.length === 1)

    expect(getFrame()).toContain('Show tips')
    expect(getFrame()).toContain('true')

    stdin.write('\u001b')
    await waitForCondition(() => onClose.mock.calls.length === 1)
    expect(updateSettingsForTest).toHaveBeenCalledTimes(1)
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('failed submenu persistence keeps the submenu open and retryable', async () => {
  const { Config } = await import(`./Config.js?submenuFailure=${Date.now()}`)
  const { stdin, stdout, getFrame } = makeStdio()
  const setTabsHidden = mock((_hidden: boolean) => {})
  const instance = await render(
    <AppStateProvider initialState={getDefaultAppState()}>
      <KeybindingSetup>
        <Config
          context={context}
          onClose={() => {}}
          setTabsHidden={setTabsHidden}
        />
      </KeybindingSetup>
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => getFrame().includes('Type to filter'))
    stdin.write('Output style')
    await waitForCondition(() => getFrame().includes('Output style'))
    stdin.write('\r')
    await Bun.sleep(20)
    stdin.write(' ')
    await waitForCondition(() => completeOutputStyle !== undefined)

    completeOutputStyle?.('Explanatory')
    expect(updateSettingsForTest).toHaveBeenCalledTimes(1)
    expect(setTabsHidden.mock.calls).toEqual([[true]])
    expect(getFrame()).toContain('Test output style picker')

    persistError = null
    completeOutputStyle?.('Explanatory')
    await waitForCondition(() => setTabsHidden.mock.calls.length === 2)
    expect(updateSettingsForTest).toHaveBeenCalledTimes(2)
    expect(setTabsHidden.mock.calls).toEqual([[true], [false]])
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('failed rollback keeps Config open and retries on the next Escape', async () => {
  persistError = null
  const { Config } = await import(`./Config.js?rollbackFailure=${Date.now()}`)
  const { stdin, stdout, getFrame } = makeStdio()
  const onClose = mock(() => {})
  const instance = await render(
    <AppStateProvider initialState={getDefaultAppState()}>
      <KeybindingSetup>
        <Config
          context={context}
          onClose={onClose}
          setTabsHidden={() => {}}
        />
      </KeybindingSetup>
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => getFrame().includes('Show tips'))
    stdin.write('Show tips')
    await waitForCondition(() => getFrame().includes('⌕ Show tips'))
    stdin.write('\r')
    await waitForCondition(() => !getFrame().includes('Type to filter'))
    stdin.write(' ')
    await waitForCondition(() => updateSettingsForTest.mock.calls.length === 1)

    persistError = new Error('settings locked')
    stdin.write('\u001b')
    await waitForCondition(() => updateSettingsForTest.mock.calls.length === 3)
    expect(onClose).not.toHaveBeenCalled()
    expect(getFrame()).toContain('Could not restore settings')

    persistError = null
    stdin.write('\u001b')
    await waitForCondition(() => onClose.mock.calls.length === 1)
    expect(updateSettingsForTest).toHaveBeenCalledTimes(5)
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})
