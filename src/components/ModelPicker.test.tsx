import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { render } from '../ink.js'
import { AppStateProvider, getDefaultAppState } from '../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../utils/settings/settingsCache.js'
import type { SettingsJson } from '../utils/settings/types.js'

type SettingsModule = typeof import('../utils/settings/settings.js')

let actualSettingsModule: SettingsModule | undefined
let settingsForTest: SettingsJson = {}

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
