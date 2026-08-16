import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { render, Text } from '../ink.js'
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js'
import {
  AppStateProvider,
  getDefaultAppState,
  useAppState,
  useSetAppState,
} from '../state/AppState.js'
import { onChangeAppState } from '../state/onChangeAppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { settingsWriteResult } from '../test/settingsWriteResult.js'
import { SWITCH_PROFILE_VALUE_PREFIX } from '../utils/model/modelOptions.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../utils/settings/settingsCache.js'
import type { SettingsJson } from '../utils/settings/types.js'

type SettingsModule = typeof import('../utils/settings/settings.js')

let actualSettingsModule: SettingsModule | undefined
let settingsForTest: SettingsJson = {}
let updateSettingsForTest = mock(
  (..._args: Parameters<SettingsModule['updateSettingsForSourceWithResult']>) =>
    settingsWriteResult({ written: true }),
)

function useSettings(settings: SettingsJson): void {
  settingsForTest = settings
  setSessionSettingsCache({ settings, errors: [] })
}

async function mockSettingsForTest(): Promise<void> {
  actualSettingsModule ??= await import(
    `../utils/settings/settings.ts?modelPickerSettingsActual=${Date.now()}-${Math.random()}`
  )
  mock.module('../utils/settings/settings.js', () => ({
    ...actualSettingsModule!,
    getInitialSettings: () => settingsForTest,
    getSettings_DEPRECATED: () => settingsForTest,
    getSettingsForSource: () => settingsForTest,
    updateSettingsForSource: (...args: Parameters<SettingsModule['updateSettingsForSource']>) =>
      ({ error: updateSettingsForTest(...args).error }),
    updateSettingsForSourceWithResult: (...args: Parameters<SettingsModule['updateSettingsForSourceWithResult']>) =>
      updateSettingsForTest(...args),
  }))
  mock.module('../utils/model/modelAllowlist.js', () => ({
    isModelAllowed: isModelAllowedForTest,
  }))
}

function isModelAllowedForTest(model: string): boolean {
  const { availableModels } = settingsForTest
  if (!availableModels) {
    return true
  }
  if (availableModels.length === 0) {
    return false
  }

  const normalizedModel = model.trim().toLowerCase()
  return availableModels.some(
    allowed => allowed.trim().toLowerCase() === normalizedModel,
  )
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

  throw new Error('Timed out waiting for ModelPicker test condition')
}

beforeEach(async () => {
  await acquireSharedMutationLock('components/ModelPicker.test.tsx')
  mock.restore()
  settingsForTest = {}
  updateSettingsForTest = mock(
    (..._args: Parameters<SettingsModule['updateSettingsForSource']>) =>
      settingsWriteResult({ written: true }),
  )
  await mockSettingsForTest()
  useSettings({} as SettingsJson)
})

afterEach(() => {
  try {
    mock.restore()
    resetSettingsCache()
    settingsForTest = {}
  } finally {
    releaseSharedMutationLock()
  }
})

test('does not append a blocked current model to filtered override options', async () => {
  useSettings({ availableModels: ['allowed-model'] } as SettingsJson)
  const { ModelPicker } = await import(
    `./ModelPicker.js?blocked-current-${Date.now()}`
  )
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

  const instance = await render(
    <AppStateProvider
      initialState={{
        ...getDefaultAppState(),
        mainLoopModel: 'blocked-model',
      }}
    >
      <ModelPicker
        initial="blocked-model"
        onSelect={() => {}}
        optionsOverride={[
          {
            value: 'allowed-model',
            label: 'Allowed Model',
            description: 'Allowed by policy',
          },
        ]}
      />
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => stripAnsi(output).includes('Allowed Model'))
    const rendered = stripAnsi(output)
    expect(rendered).toContain('Allowed Model')
    expect(rendered).not.toContain('blocked-model')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('matches current model to override options case-insensitively', async () => {
  const { ModelPicker } = await import(
    `./ModelPicker.js?case-current-${Date.now()}`
  )
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

  const instance = await render(
    <AppStateProvider
      initialState={{
        ...getDefaultAppState(),
        mainLoopModel: 'GLM-5.2',
      }}
    >
      <ModelPicker
        initial="GLM-5.2"
        onSelect={() => {}}
        optionsOverride={[
          {
            value: 'glm-5.2',
            label: 'GLM 5.2',
            description: 'Provider: Hicap',
          },
        ]}
      />
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => stripAnsi(output).includes('GLM 5.2'))
    const rendered = stripAnsi(output)
    expect(rendered).toContain('GLM 5.2')
    expect(rendered).not.toContain('Current model')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

function makeStdio(): {
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdout: PassThrough
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
  return { stdin, stdout, getOutput: () => output }
}

const CROSS_PROFILE_OPTIONS = [
  {
    value: 'claude-opus-4-6',
    label: 'Active Model',
    description: 'Current profile',
  },
  {
    value: `${SWITCH_PROFILE_VALUE_PREFIX}work:gpt-5.5`,
    label: 'Switch to Work · gpt-5.5',
    description: 'Inactive provider profile',
    // Genuine switch option carries the marker (as production builds it).
    switchToProfileId: 'work',
  },
  {
    // A real custom model id that merely starts with the switch prefix but is
    // NOT a switch option (no switchToProfileId marker). It must stay visible in
    // inline pickers — the filter keys on the marker, not the raw value prefix.
    value: `${SWITCH_PROFILE_VALUE_PREFIX}vendor:gpt-5.4`,
    label: 'Prefixed Custom Model',
    description: 'Literal custom model, not a switch',
  },
]

test('hides cross-profile switch options when allowProfileSwitch is falsy', async () => {
  const { ModelPicker } = await import(
    `./ModelPicker.js?cross-profile-hidden-${Date.now()}`
  )
  const { stdin, stdout, getOutput } = makeStdio()

  const instance = await render(
    <AppStateProvider initialState={getDefaultAppState()}>
      <ModelPicker
        initial="claude-opus-4-6"
        onSelect={() => {}}
        optionsOverride={CROSS_PROFILE_OPTIONS}
      />
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => stripAnsi(getOutput()).includes('Active Model'))
    const rendered = stripAnsi(getOutput())
    expect(rendered).toContain('Active Model')
    // The inline picker cannot honor a profile switch, so the marked switch
    // option must never surface.
    expect(rendered).not.toContain('Switch to Work')
    expect(rendered).not.toContain(SWITCH_PROFILE_VALUE_PREFIX)
    // ...but a real custom model that merely starts with the prefix is NOT a
    // switch (no marker) and must remain visible.
    expect(rendered).toContain('Prefixed Custom Model')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('shows cross-profile switch options when allowProfileSwitch is set', async () => {
  const { ModelPicker } = await import(
    `./ModelPicker.js?cross-profile-shown-${Date.now()}`
  )
  const { stdin, stdout, getOutput } = makeStdio()

  const instance = await render(
    <AppStateProvider initialState={getDefaultAppState()}>
      <ModelPicker
        initial="claude-opus-4-6"
        onSelect={() => {}}
        allowProfileSwitch
        optionsOverride={CROSS_PROFILE_OPTIONS}
      />
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() =>
      stripAnsi(getOutput()).includes('Switch to Work'),
    )
    const rendered = stripAnsi(getOutput())
    expect(rendered).toContain('Active Model')
    expect(rendered).toContain('Switch to Work')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('keeps the active model when selecting a different model cannot be persisted', async () => {
  updateSettingsForTest = mock(
    (..._args: Parameters<SettingsModule['updateSettingsForSource']>) =>
      settingsWriteResult({ written: false }),
  )
  const { ModelPicker } = await import(
    `./ModelPicker.js?model-write-failure-${Date.now()}`
  )
  const { stdin, stdout, getOutput } = makeStdio()
  const initialState = {
    ...getDefaultAppState(),
    mainLoopModel: 'claude-haiku-4-5' as const,
  }

  function ModelSelectionHarness(): React.ReactNode {
    const model = useAppState(state => state.mainLoopModel)
    const setAppState = useSetAppState()
    return <>
      <Text>Current model: {model}</Text>
      <ModelPicker
        initial="claude-haiku-4-5"
        skipSettingsWrite
        onSelect={selectedModel => {
          setAppState(previous => ({
            ...previous,
            mainLoopModel: selectedModel,
          }))
        }}
        optionsOverride={[
          {
            value: 'claude-haiku-4-5',
            label: 'Haiku',
            description: 'Current model',
          },
          {
            value: 'claude-opus-4-6',
            label: 'Opus',
            description: 'Different model',
          },
        ]}
      />
    </>
  }

  const instance = await render(
    <AppStateProvider
      initialState={initialState}
      onChangeAppState={args =>
        onChangeAppState(args, {
          updateUserSettings: (...updateArgs) =>
            updateSettingsForTest(...updateArgs),
          setModelOverride: () => {},
        })
      }
    >
      <KeybindingSetup>
        <ModelSelectionHarness />
      </KeybindingSetup>
    </AppStateProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  try {
    await waitForCondition(() => stripAnsi(getOutput()).includes('Opus'))
    stdin.write('j')
    await waitForCondition(() => /❯[^\n]*Opus/.test(stripAnsi(getOutput())))
    stdin.write('\r')
    await waitForCondition(() =>
      updateSettingsForTest.mock.calls.some(
        ([source, patch]) =>
          source === 'userSettings' && patch.model === 'claude-opus-4-6',
      ),
    )

    expect(updateSettingsForTest).toHaveBeenCalledWith('userSettings', {
      model: 'claude-opus-4-6',
    })
    expect(stripAnsi(getOutput())).toContain('Current model: claude-haiku-4-5')
    expect(stripAnsi(getOutput())).not.toContain('Current model: claude-opus-4-6')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('keeps the picker open when the parent rejects the atomic model and effort write', async () => {
  useSettings({ effortLevel: 'low' })
  const { ModelPicker } = await import(
    `./ModelPicker.js?write-failure-${Date.now()}`
  )
  const { stdin, stdout, getOutput } = makeStdio()
  const onSelect = mock(() =>
    'Could not save model and effort preference: settings were not written'
  )
  const initialState = {
    ...getDefaultAppState(),
    effortValue: 'medium' as const,
  }
  const initialEffort = initialState.effortValue
  let observedEffort: ReturnType<typeof getDefaultAppState>['effortValue'] =
    initialEffort

  const instance = await render(
    <AppStateProvider
      initialState={initialState}
      onChangeAppState={({ newState }) => {
        observedEffort = newState.effortValue
      }}
    >
      <KeybindingSetup>
        <ModelPicker
          initial="claude-opus-4-6"
          onSelect={onSelect}
          optionsOverride={[
            {
              value: 'claude-opus-4-6',
              label: 'Opus',
              description: 'Effort-capable model',
            },
          ]}
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
    await waitForCondition(() => stripAnsi(getOutput()).includes('Opus'))
    const outputBeforeEffortChange = getOutput().length
    stdin.write('\u001b[C')
    await waitForCondition(() =>
      stripAnsi(getOutput().slice(outputBeforeEffortChange)).includes(
        'High effort',
      ),
    )
    stdin.write('\r')
    await waitForCondition(() =>
      stripAnsi(getOutput()).includes(
        'Could not save model and effort preference: settings were not written',
      ),
    )

    expect(onSelect).toHaveBeenCalledWith(
      'claude-opus-4-6',
      'high',
      undefined,
      expect.objectContaining({
        settingsPatch: { effortLevel: 'high' },
        effortValue: 'high',
        wroteEffort: true,
      }),
    )
    expect(observedEffort).toBe(initialEffort)
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('passes effort persistence to the parent for one coordinated transaction', async () => {
  useSettings({ effortLevel: 'low' })
  const { ModelPicker } = await import(
    `./ModelPicker.js?landed-write-error-${Date.now()}`
  )
  const { stdin, stdout, getOutput } = makeStdio()
  const onSelect = mock(() => {})
  const initialState = {
    ...getDefaultAppState(),
    effortValue: 'medium' as const,
  }
  const initialEffort = initialState.effortValue
  let observedEffort: ReturnType<typeof getDefaultAppState>['effortValue'] =
    initialEffort

  const instance = await render(
    <AppStateProvider
      initialState={initialState}
      onChangeAppState={({ newState }) => {
        observedEffort = newState.effortValue
      }}
    >
      <KeybindingSetup>
        <ModelPicker
          initial="claude-opus-4-6"
          onSelect={onSelect}
          optionsOverride={[
            {
              value: 'claude-opus-4-6',
              label: 'Opus',
              description: 'Effort-capable model',
            },
          ]}
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
    await waitForCondition(() => stripAnsi(getOutput()).includes('Opus'))
    const outputBeforeEffortChange = getOutput().length
    stdin.write('\u001b[C')
    await waitForCondition(() =>
      stripAnsi(getOutput().slice(outputBeforeEffortChange)).includes(
        'High effort',
      ),
    )
    stdin.write('\r')
    await waitForCondition(() => onSelect.mock.calls.length === 1)

    expect(onSelect).toHaveBeenCalledWith(
      'claude-opus-4-6',
      'high',
      undefined,
      expect.objectContaining({
        settingsPatch: { effortLevel: 'high' },
        effortValue: 'high',
        wroteEffort: true,
      }),
    )
    expect(observedEffort).toBe(initialEffort)
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})
