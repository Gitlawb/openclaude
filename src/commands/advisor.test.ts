import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { settingsWriteResult } from '../test/settingsWriteResult.js'
import * as validateModelModule from '../utils/model/validateModel.js'
import * as settingsModule from '../utils/settings/settings.js'
import command from './advisor.js'

let writeSpy: ReturnType<typeof spyOn>
let validateModelSpy: ReturnType<typeof spyOn> | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('commands/advisor.test.ts')
})

afterEach(() => {
  try {
    writeSpy?.mockRestore()
    validateModelSpy?.mockRestore()
    validateModelSpy = undefined
  } finally {
    releaseSharedMutationLock()
  }
})

function makeContext() {
  const state = {
    mainLoopModel: 'claude-opus-4-6',
    advisorModel: 'claude-opus-4-6',
  }
  return {
    getAppState: () => state,
    setAppState: () => {
      throw new Error('rejected writes must not update app state')
    },
  } as never
}

test('advisor enable reports the settings write error', async () => {
  validateModelSpy = spyOn(validateModelModule, 'validateModel').mockResolvedValue({
    valid: true,
  })
  writeSpy = spyOn(
    settingsModule,
    'updateSettingsForSourceWithResult',
  ).mockReturnValue(
    settingsWriteResult({
      error: new Error('settings file is locked'),
      written: false,
    }),
  )
  const call = (await command.load()).call

  await expect(
    call('claude-opus-4-6', makeContext()),
  ).resolves.toMatchObject({
    type: 'text',
    value: 'Failed to set advisor: settings file is locked',
  })
})

test('advisor disable reports the fallback for a refused write without an error', async () => {
  writeSpy = spyOn(
    settingsModule,
    'updateSettingsForSourceWithResult',
  ).mockReturnValue(settingsWriteResult({ written: false }))
  const call = (await command.load()).call

  await expect(call('unset', makeContext())).resolves.toMatchObject({
    type: 'text',
    value: 'Failed to disable advisor: settings were not written',
  })
})
