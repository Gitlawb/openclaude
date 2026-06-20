import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import command from './index.js'
import * as settingsModule from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'

// Two model-only agentModels keys with first-party-priced models so the
// cheaper-than warning can be exercised: haiku (cheap) vs opus (expensive).
const AGENT_MODELS = {
  mini: { model: 'claude-haiku-4-5' },
  main: { model: 'claude-opus-4-5' },
}

function makeContext(initial: Partial<SettingsJson> = {}) {
  let state = {
    settings: { agentModels: AGENT_MODELS, ...initial } as SettingsJson,
  }
  return {
    getAppState: () => state as never,
    setAppState: (updater: (s: typeof state) => typeof state) => {
      state = updater(state)
    },
    _state: () => state,
  } as unknown as Parameters<Awaited<ReturnType<typeof command.load>>['call']>[1] & {
    _state: () => typeof state
  }
}

describe('/smartroute command', () => {
  let writeSpy: ReturnType<typeof spyOn>
  let call: Awaited<ReturnType<typeof command.load>>['call']

  beforeEach(async () => {
    writeSpy = spyOn(settingsModule, 'updateSettingsForSource').mockImplementation(() => undefined as never)
    call = (await command.load()).call
  })
  afterEach(() => writeSpy.mockRestore())

  test('status with no config shows disabled and available keys', async () => {
    const ctx = makeContext()
    const res = await call('', ctx)
    expect(res.value).toContain('status: disabled')
    expect(res.value).toContain('mini, main')
  })

  test('on without both roles set is rejected', async () => {
    const ctx = makeContext({ smartRouting: { enabled: false, simpleModel: 'mini' } })
    const res = await call('on', ctx)
    expect(res.value).toContain('Set both roles first')
    expect(writeSpy).not.toHaveBeenCalled()
  })

  test('setting simple/strong to a valid key persists', async () => {
    const ctx = makeContext()
    await call('simple mini', ctx)
    expect(writeSpy).toHaveBeenCalledWith('userSettings', { smartRouting: { simpleModel: 'mini' } })
    expect((ctx as never as { _state: () => { settings: SettingsJson } })._state().settings.smartRouting).toEqual({
      simpleModel: 'mini',
    })
  })

  test('setting a role to an unknown key is rejected with available keys', async () => {
    const ctx = makeContext()
    const res = await call('simple nope', ctx)
    expect(res.value).toContain('not a configured agentModels key')
    expect(res.value).toContain('mini, main')
    expect(writeSpy).not.toHaveBeenCalled()
  })

  test('enabling with simple cheaper than strong gives no warning', async () => {
    const ctx = makeContext({ smartRouting: { enabled: false, simpleModel: 'mini', strongModel: 'main' } })
    const res = await call('on', ctx)
    expect(res.value).toContain('Smart routing enabled')
    expect(res.value).not.toContain('Heads up')
    expect(writeSpy).toHaveBeenCalledWith('userSettings', {
      smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' },
    })
  })

  test('warns when the simple model is not cheaper than the strong model', async () => {
    // Swap roles: simple=opus (expensive), strong=haiku (cheap).
    const ctx = makeContext({ smartRouting: { enabled: false, simpleModel: 'main', strongModel: 'mini' } })
    const res = await call('on', ctx)
    expect(res.value).toContain('Heads up')
    expect(res.value).toContain('not cheaper')
  })

  test('off disables', async () => {
    const ctx = makeContext({ smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' } })
    const res = await call('off', ctx)
    expect(res.value).toContain('disabled')
    expect(writeSpy).toHaveBeenCalledWith('userSettings', {
      smartRouting: { enabled: false, simpleModel: 'mini', strongModel: 'main' },
    })
  })
})
