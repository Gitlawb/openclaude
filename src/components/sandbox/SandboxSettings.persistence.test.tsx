import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import React from 'react'
import { render } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider, getDefaultAppState } from '../../state/AppState.js'
import { createWaitForCondition } from '../../test/waitForCondition.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { SandboxSettings } from './SandboxSettings.js'

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
    getOutput: () => stripAnsi(output),
  }
}

const waitForCondition = createWaitForCondition(
  'Sandbox settings persistence test condition',
)

afterEach(() => {
  spyOn(SandboxManager, 'isSandboxingEnabled').mockRestore()
  spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockRestore()
  spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockRestore()
  spyOn(SandboxManager, 'areSandboxSettingsLockedByPolicy').mockRestore()
  spyOn(SandboxManager, 'setSandboxSettings').mockRestore()
})

test('keeps the dialog open and displays a rejected settings update', async () => {
  spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(false)
  spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockReturnValue(
    false,
  )
  spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockReturnValue(false)
  spyOn(SandboxManager, 'areSandboxSettingsLockedByPolicy').mockReturnValue(
    false,
  )
  const setSandboxSettings = spyOn(
    SandboxManager,
    'setSandboxSettings',
  ).mockRejectedValue(
    new Error('ELOCKED'),
  )
  const onComplete = mock(() => {})
  const { stdin, stdout, getOutput } = makeStdio()
  const instance = await render(
    <AppStateProvider initialState={getDefaultAppState()}>
      <KeybindingSetup>
        <SandboxSettings
          depCheck={{ errors: [], warnings: [] }}
          onComplete={onComplete}
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
    await waitForCondition(() => getOutput().includes('Configure Mode'))
    await Bun.sleep(50)
    stdin.write('\u001b[B')
    await Bun.sleep(50)
    stdin.write('\u001b[B')
    await Bun.sleep(50)
    stdin.write('\r')
    await waitForCondition(() => setSandboxSettings.mock.calls.length === 1)
    await waitForCondition(() =>
      getOutput().includes('Failed to update sandbox settings: ELOCKED'),
    )

    expect(onComplete).not.toHaveBeenCalled()
    expect(getOutput()).toContain('Configure Mode')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})
